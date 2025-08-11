use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Command, Stdio, Child};
use std::io::{Write, BufRead, BufReader};
use std::sync::Mutex;
use tauri::Window;
use rust_decimal::prelude::*;
use std::time::Instant;

// Constants for restart protection
const MAX_RESTART_ATTEMPTS: u32 = 5;
const RESTART_BACKOFF_MS: [u64; 5] = [1000, 2000, 4000, 8000, 16000];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentOutput {
    pub stdout: String,
    pub stderr: String,
    pub execution_time: f64,
    pub indicator_values: Option<HashMap<String, Vec<f64>>>,
    pub signal_data: Option<SignalData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalData {
    pub signal_type: String,
    pub strength: f64,
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndicatorOutput {
    pub values: Vec<f64>,
    pub current: f64,
}

/// Manages the persistent Python component server process
pub struct ComponentExecutor {
    process: Child,
    request_counter: u64,
    reader: BufReader<std::process::ChildStdout>,
    restart_count: u32,
    last_restart: Option<Instant>,
}

impl ComponentExecutor {
    /// Start a new component server process
    pub fn new() -> Result<Self, String> {
        // Get the path to the component server script
        // When running from Tauri dev, current directory is already src-tauri
        let server_path = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?
            .join("src")
            .join("orchestrator")
            .join("component_server.py");
        
        
        // Check if the script exists
        if !server_path.exists() {
            return Err(format!("Component server script not found at: {:?}", server_path));
        }
        
        // Get project root directory (parent of src-tauri)
        // When running from Tauri, we're already in src-tauri, so go up one level
        let project_root = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?
            .parent()
            .ok_or("Failed to get parent directory")?
            .to_path_buf();
        
        eprintln!("[ComponentExecutor] Starting server from: {:?}", project_root);
        eprintln!("[ComponentExecutor] Server script path: {:?}", server_path);
        
        // Start the Python server process with correct working directory
        let mut process = Command::new("python3")
            .arg(&server_path)
            .current_dir(&project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())  // Let stderr go to console for debugging
            .spawn()
            .map_err(|e| format!("Failed to start component server: {}", e))?;
        
        // Wait a moment for the server to initialize
        std::thread::sleep(std::time::Duration::from_millis(500));
        
        // Check if process is still running
        match process.try_wait() {
            Ok(Some(status)) => {
                // Try to get error output
                let mut error_msg = format!("Component server exited immediately with status: {}", status);
                if let Some(stderr) = process.stderr.take() {
                    use std::io::Read;
                    let mut stderr_output = String::new();
                    let mut reader = stderr;
                    if let Ok(_) = reader.read_to_string(&mut stderr_output) {
                        error_msg = format!("{}\nStderr output:\n{}", error_msg, stderr_output);
                    }
                }
                return Err(error_msg);
            }
            Ok(None) => {
                // Process is still running, good
            }
            Err(e) => {
                return Err(format!("Failed to check component server status: {}", e));
            }
        }
        
        // Take stdout for the reader
        let stdout = process.stdout.take()
            .ok_or("Failed to get stdout handle")?;
        
        let reader = BufReader::new(stdout);
        
        Ok(ComponentExecutor {
            process,
            request_counter: 0,
            reader,
            restart_count: 0,
            last_restart: Some(Instant::now()),
        })
    }
    
    /// Create a new executor with existing restart count
    fn new_with_restart_count(restart_count: u32) -> Result<Self, String> {
        let mut executor = Self::new()?;
        executor.restart_count = restart_count;
        Ok(executor)
    }
    
    /// Reset restart count after successful operation
    fn reset_restart_count(&mut self) {
        if self.restart_count > 0 {
            eprintln!("[ComponentExecutor] Resetting restart count after successful operation");
            self.restart_count = 0;
        }
    }
    
    /// Send a request to the component server and wait for response
    fn send_request(&mut self, request: serde_json::Value) -> Result<serde_json::Value, String> {
        eprintln!("[ComponentExecutor] Sending request: {:?}", request);
        
        // Check if process is still alive
        match self.process.try_wait() {
            Ok(Some(status)) => {
                return Err(format!("Component server has exited with status: {}", status));
            }
            Ok(None) => {
                // Process is still running
            }
            Err(e) => {
                return Err(format!("Failed to check process status: {}", e));
            }
        }
        
        // Get stdin handle
        let stdin = self.process.stdin.as_mut()
            .ok_or("Failed to get stdin handle")?;
        
        // Write request as JSON line
        let request_str = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?;
        
        writeln!(stdin, "{}", request_str)
            .map_err(|e| format!("Failed to write to component server: {}", e))?;
        
        stdin.flush()
            .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        
        eprintln!("[ComponentExecutor] Request sent, waiting for response...");
        
        // Read response from the persistent reader
        let mut response_line = String::new();
        
        self.reader.read_line(&mut response_line)
            .map_err(|e| format!("Failed to read from component server: {}", e))?;
        
        eprintln!("[ComponentExecutor] Got response: {}", response_line);
        
        if response_line.is_empty() {
            return Err("Component server closed connection".to_string());
        }
        
        // Parse response
        serde_json::from_str(&response_line.trim())
            .map_err(|e| format!("Failed to parse response: {}", e))
    }
    
    /// Execute an indicator component
    pub fn execute_indicator(
        &mut self,
        component_path: &str,
        candles: &[super::Candle],
        params: HashMap<String, serde_json::Value>,
    ) -> Result<HashMap<String, Vec<f64>>, String> {
        self.request_counter += 1;
        
        // Convert candles to the format expected by the server
        let candles_json: Vec<serde_json::Value> = candles.iter()
            .map(|c| serde_json::json!({
                "time": c.time.timestamp(),
                "open": c.open.to_f64().unwrap_or(0.0),
                "high": c.high.to_f64().unwrap_or(0.0),
                "low": c.low.to_f64().unwrap_or(0.0),
                "close": c.close.to_f64().unwrap_or(0.0),
                "volume": c.volume,
            }))
            .collect();
        
        let request = serde_json::json!({
            "id": format!("indicator_{}", self.request_counter),
            "command": "execute",
            "component_type": "indicator",
            "component_path": component_path,
            "candles": candles_json,
            "params": params,
        });
        
        let response = self.send_request(request)?;
        
        // Check if successful
        let success = response.get("success")
            .and_then(|v| v.as_bool())
            .ok_or("Invalid response: missing success field")?;
        
        if !success {
            let error = response.get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return Err(format!("Component execution failed: {}", error));
        }
        
        // Extract indicator values
        let result = response.get("result")
            .ok_or("Invalid response: missing result field")?;
        
        let values = result.get("indicator_values")
            .and_then(|v| v.as_array())
            .ok_or("Invalid response: missing indicator_values")?;
        
        let float_values: Vec<f64> = values.iter()
            .map(|v| v.as_f64().unwrap_or(0.0))
            .collect();
        
        let mut result_map = HashMap::new();
        result_map.insert("default".to_string(), float_values);
        
        Ok(result_map)
    }
    
    /// Get component metadata
    pub fn get_component_metadata(
        &mut self,
        component_type: &str,
        component_path: &str,
    ) -> Result<serde_json::Value, String> {
        self.request_counter += 1;
        
        let request = serde_json::json!({
            "id": format!("metadata_{}", self.request_counter),
            "command": "get_metadata",
            "component_type": component_type,
            "component_path": component_path,
        });
        
        let response = self.send_request(request)?;
        
        // Check if successful
        let success = response.get("success")
            .and_then(|v| v.as_bool())
            .ok_or("Invalid response: missing success field")?;
        
        if !success {
            let error = response.get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return Err(format!("Failed to get metadata: {}", error));
        }
        
        // Extract metadata
        let result = response.get("result")
            .ok_or("Invalid response: missing result field")?;
        
        let metadata = result.get("metadata")
            .cloned()
            .unwrap_or(serde_json::json!({}));
        
        Ok(metadata)
    }
    
    /// Execute a signal component
    pub fn execute_signal(
        &mut self,
        component_path: &str,
        candles: &[super::Candle],
        params: HashMap<String, serde_json::Value>,
        indicator_data: HashMap<String, Vec<f64>>,
    ) -> Result<Vec<super::SignalEvent>, String> {
        self.request_counter += 1;
        
        // Convert candles to the format expected by the server
        let candles_json: Vec<serde_json::Value> = candles.iter()
            .map(|c| serde_json::json!({
                "time": c.time.timestamp(),
                "open": c.open.to_f64().unwrap_or(0.0),
                "high": c.high.to_f64().unwrap_or(0.0),
                "low": c.low.to_f64().unwrap_or(0.0),
                "close": c.close.to_f64().unwrap_or(0.0),
                "volume": c.volume,
            }))
            .collect();
        
        let request = serde_json::json!({
            "id": format!("signal_{}", self.request_counter),
            "command": "execute",
            "component_type": "signal",
            "component_path": component_path,
            "candles": candles_json,
            "params": params,
            "indicator_data": indicator_data,
        });
        
        let response = self.send_request(request)?;
        
        // Check if successful
        let success = response.get("success")
            .and_then(|v| v.as_bool())
            .ok_or("Invalid response: missing success field")?;
        
        if !success {
            let error = response.get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return Err(format!("Component execution failed: {}", error));
        }
        
        // Extract signals
        let result = response.get("result")
            .ok_or("Invalid response: missing result field")?;
        
        let signals = result.get("signals")
            .and_then(|v| v.as_array())
            .ok_or("Invalid response: missing signals")?;
        
        // Convert to SignalEvent structs
        let mut signal_events = Vec::new();
        for signal in signals {
            if let Ok(timestamp) = chrono::DateTime::parse_from_rfc3339(
                signal.get("timestamp").and_then(|v| v.as_str()).unwrap_or("")
            ) {
                let signal_event = super::SignalEvent {
                    timestamp: timestamp.with_timezone(&chrono::Utc),
                    signal_name: signal.get("signal_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    signal_type: signal.get("signal_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    strength: signal.get("strength")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0),
                    metadata: signal.get("metadata")
                        .and_then(|v| v.as_object())
                        .map(|obj| {
                            obj.iter()
                                .map(|(k, v)| (k.clone(), v.clone()))
                                .collect()
                        })
                        .unwrap_or_default(),
                };
                signal_events.push(signal_event);
            }
        }
        
        Ok(signal_events)
    }
    
    /// Shutdown the component server
    pub fn shutdown(&mut self) -> Result<(), String> {
        let request = serde_json::json!({
            "id": "shutdown",
            "command": "shutdown",
        });
        
        // Send shutdown request
        let _ = self.send_request(request);
        
        // Wait for process to exit
        match self.process.wait() {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to wait for component server shutdown: {}", e)),
        }
    }
}

impl Drop for ComponentExecutor {
    fn drop(&mut self) {
        // Try to shutdown gracefully
        let _ = self.shutdown();
        
        // If still running, kill it
        let _ = self.process.kill();
    }
}

/// Global component executor instance
pub static COMPONENT_EXECUTOR: Mutex<Option<ComponentExecutor>> = Mutex::new(None);

/// Global restart counter (persists across executor instances)
pub static RESTART_COUNT: Mutex<u32> = Mutex::new(0);

/// Initialize the component executor
pub fn initialize_component_executor() -> Result<(), String> {
    let mut executor_guard = COMPONENT_EXECUTOR.lock()
        .map_err(|e| format!("Failed to lock component executor: {}", e))?;
    
    if executor_guard.is_none() {
        *executor_guard = Some(ComponentExecutor::new()?);
    }
    
    Ok(())
}

/// Shutdown the component executor
pub fn shutdown_component_executor() -> Result<(), String> {
    let mut executor_guard = COMPONENT_EXECUTOR.lock()
        .map_err(|e| format!("Failed to lock component executor: {}", e))?;
    
    if let Some(mut executor) = executor_guard.take() {
        executor.shutdown()?;
    }
    
    Ok(())
}

/// Run a component with candle data and return structured output
pub async fn run_component_for_candle(
    component_type: &str,
    component_path: &str,
    candle_data: &[super::Candle],
    candle_index: usize,
    env_vars: HashMap<String, String>,
    _window: &Window,
    lookback_required: usize,
) -> Result<ComponentOutput, String> {
    let start_time = Instant::now();
    
    // Get executor
    let mut executor_guard = COMPONENT_EXECUTOR.lock()
        .map_err(|e| format!("Failed to lock component executor: {}", e))?;
    
    // Check if we need to restart the executor
    if let Some(executor) = executor_guard.as_mut() {
        // Check if process is still alive
        match executor.process.try_wait() {
            Ok(Some(_)) => {
                // Process has exited, need to restart
                let mut restart_guard = RESTART_COUNT.lock()
                    .map_err(|e| format!("Failed to lock restart counter: {}", e))?;
                
                *restart_guard += 1;
                let current_restart_count = *restart_guard;
                drop(restart_guard);
                
                eprintln!("[ComponentExecutor] Component server has died, restart attempt {} of {}", 
                    current_restart_count, MAX_RESTART_ATTEMPTS);
                
                if current_restart_count > MAX_RESTART_ATTEMPTS {
                    return Err(format!(
                        "Component server has crashed {} times, exceeded maximum restart attempts", 
                        current_restart_count - 1
                    ));
                }
                
                // Apply exponential backoff
                let backoff_index = (current_restart_count - 1).min(4) as usize;
                let backoff_ms = RESTART_BACKOFF_MS[backoff_index];
                eprintln!("[ComponentExecutor] Waiting {}ms before restart...", backoff_ms);
                std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
                
                *executor_guard = None;
            }
            Ok(None) => {
                // Process is still running
            }
            Err(e) => {
                eprintln!("[ComponentExecutor] Failed to check process status: {}", e);
                *executor_guard = None;
            }
        }
    }
    
    // Initialize if needed
    if executor_guard.is_none() {
        let restart_guard = RESTART_COUNT.lock()
            .map_err(|e| format!("Failed to lock restart counter: {}", e))?;
        let current_restart_count = *restart_guard;
        drop(restart_guard);
        
        *executor_guard = Some(ComponentExecutor::new_with_restart_count(current_restart_count)?);
    }
    
    let executor = executor_guard.as_mut()
        .ok_or("Component executor not initialized")?;
    
    // Extract relevant candles with lookback window
    let start_idx = candle_index.saturating_sub(lookback_required.saturating_sub(1));
    let relevant_candles = &candle_data[start_idx..=candle_index];
    
    eprintln!("[ComponentExecutor] Candle index: {}, Lookback: {}, Start idx: {}, Sending {} candles", 
        candle_index, lookback_required, start_idx, relevant_candles.len());
    
    // Prepare output
    let mut output = ComponentOutput {
        stdout: String::new(),
        stderr: String::new(),
        execution_time: 0.0,
        indicator_values: None,
        signal_data: None,
    };
    
    match component_type {
        "indicator" => {
            // Parse parameters from env_vars
            let params = parse_params_from_env(&env_vars);
            
            // Execute indicator
            let values = executor.execute_indicator(component_path, relevant_candles, params)?;
            output.indicator_values = Some(values);
            
            // Reset restart counter on successful execution
            executor.reset_restart_count();
            if let Ok(mut restart_guard) = RESTART_COUNT.lock() {
                if *restart_guard > 0 {
                    eprintln!("[ComponentExecutor] Resetting global restart counter after successful operation");
                    *restart_guard = 0;
                }
            }
        }
        "signal" => {
            // For signals, we need to calculate required indicators first
            // This would be handled by the orchestrator before calling this function
            // For now, just parse params
            let params = parse_params_from_env(&env_vars);
            
            // If indicator data is provided in env_vars, parse it
            let indicator_data = parse_indicator_data_from_env(&env_vars);
            
            // Execute signal
            let signals = executor.execute_signal(component_path, relevant_candles, params, indicator_data)?;
            
            // Convert first signal to signal data (for backward compatibility)
            if let Some(first_signal) = signals.first() {
                output.signal_data = Some(SignalData {
                    signal_type: first_signal.signal_type.clone(),
                    strength: first_signal.strength,
                    metadata: first_signal.metadata.clone(),
                });
            }
            
            // Reset restart counter on successful execution
            executor.reset_restart_count();
            if let Ok(mut restart_guard) = RESTART_COUNT.lock() {
                if *restart_guard > 0 {
                    eprintln!("[ComponentExecutor] Resetting global restart counter after successful operation");
                    *restart_guard = 0;
                }
            }
        }
        _ => {
            return Err(format!("Unknown component type: {}", component_type));
        }
    }
    
    output.execution_time = start_time.elapsed().as_secs_f64() * 1000.0;
    
    Ok(output)
}

/// Parse component parameters from environment variables
fn parse_params_from_env(env_vars: &HashMap<String, String>) -> HashMap<String, serde_json::Value> {
    let mut params = HashMap::new();
    
    // Look for PARAMS_ prefixed variables
    for (key, value) in env_vars {
        if key.starts_with("PARAMS_") {
            let param_name = key.strip_prefix("PARAMS_").unwrap().to_lowercase();
            
            // Try to parse as number first, then as JSON, finally as string
            let param_value = if let Ok(num) = value.parse::<f64>() {
                serde_json::Value::Number(serde_json::Number::from_f64(num).unwrap())
            } else if let Ok(json_val) = serde_json::from_str(value) {
                json_val
            } else {
                serde_json::Value::String(value.clone())
            };
            
            params.insert(param_name, param_value);
        }
    }
    
    params
}

/// Parse indicator data from environment variables
fn parse_indicator_data_from_env(env_vars: &HashMap<String, String>) -> HashMap<String, Vec<f64>> {
    let mut indicator_data = HashMap::new();
    
    // Look for INDICATOR_ prefixed variables
    for (key, value) in env_vars {
        if key.starts_with("INDICATOR_") {
            let indicator_name = key.strip_prefix("INDICATOR_").unwrap().to_lowercase();
            
            // Try to parse as JSON array
            if let Ok(values) = serde_json::from_str::<Vec<f64>>(value) {
                indicator_data.insert(indicator_name, values);
            }
        }
    }
    
    indicator_data
}

/// Serialize candles to JSON format expected by components
fn serialize_candles_for_component(candles: &[super::Candle]) -> Result<String, String> {
    #[derive(Serialize)]
    struct CandleJson {
        time: i64,
        open: f64,
        high: f64,
        low: f64,
        close: f64,
        volume: i64,
    }
    
    let candle_jsons: Vec<CandleJson> = candles.iter()
        .map(|c| CandleJson {
            time: c.time.timestamp(),
            open: c.open.to_f64().unwrap_or(0.0),
            high: c.high.to_f64().unwrap_or(0.0),
            low: c.low.to_f64().unwrap_or(0.0),
            close: c.close.to_f64().unwrap_or(0.0),
            volume: c.volume,
        })
        .collect();
    
    serde_json::to_string(&candle_jsons)
        .map_err(|e| format!("Failed to serialize candles: {}", e))
}

/// Create a cache key for component outputs
pub fn get_component_cache_key(
    component_path: &str,
    candle_index: usize,
    symbol: &str,
    timeframe: &str,
) -> String {
    format!("{}:{}:{}:{}", component_path, symbol, timeframe, candle_index)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_params_from_env() {
        let mut env_vars = HashMap::new();
        env_vars.insert("PARAMS_PERIOD".to_string(), "20".to_string());
        env_vars.insert("PARAMS_THRESHOLD".to_string(), "0.5".to_string());
        env_vars.insert("PARAMS_ENABLED".to_string(), "true".to_string());
        
        let params = parse_params_from_env(&env_vars);
        
        assert_eq!(params.get("period").and_then(|v| v.as_f64()), Some(20.0));
        assert_eq!(params.get("threshold").and_then(|v| v.as_f64()), Some(0.5));
    }
}