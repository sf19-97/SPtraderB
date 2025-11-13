use super::types::{Candle, SignalEvent, StrategyConfig};
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::io::Write as IoWrite;

#[derive(Debug, Serialize)]
struct PythonBacktestInput {
    candles: Vec<CandleData>,
    strategy_config: StrategyConfigData,
}

#[derive(Debug, Serialize)]
struct CandleData {
    time: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: i64,
}

#[derive(Debug, Serialize)]
struct StrategyConfigData {
    name: String,
    dependencies: Dependencies,
    entry: serde_json::Value,
    exit: serde_json::Value,
    parameters: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct Dependencies {
    signals: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PythonBacktestOutput {
    signals: Vec<PythonSignalEvent>,
    indicators: HashMap<String, Vec<f64>>,
}

#[derive(Debug, Deserialize)]
struct PythonSignalEvent {
    timestamp: String,
    signal_name: Option<String>,  // Added to match Python output
    signal_type: String,
    strength: f64,
    price: f64,
    metadata: HashMap<String, serde_json::Value>,
}

/// Execute vectorized_backtest_v2.py to generate signals for all candles
pub async fn execute_python_backtest(
    candles: &[Candle],
    strategy_config: &StrategyConfig,
) -> Result<Vec<SignalEvent>, String> {
    tracing::info!("Executing Python backtest for {} candles", candles.len());

    // Convert candles to Python format
    let candle_data: Vec<CandleData> = candles
        .iter()
        .map(|c| CandleData {
            time: c.time.timestamp(),
            open: c.open.to_string().parse::<f64>().unwrap_or(0.0),
            high: c.high.to_string().parse::<f64>().unwrap_or(0.0),
            low: c.low.to_string().parse::<f64>().unwrap_or(0.0),
            close: c.close.to_string().parse::<f64>().unwrap_or(0.0),
            volume: c.volume,
        })
        .collect();

    // Convert strategy config to Python format
    // Convert yaml values to json values
    let entry_json: serde_json::Value = serde_yaml::from_value(strategy_config.entry.clone())
        .map_err(|e| format!("Failed to convert entry to JSON: {}", e))?;
    let exit_json: serde_json::Value = serde_yaml::from_value(strategy_config.exit.clone())
        .map_err(|e| format!("Failed to convert exit to JSON: {}", e))?;

    let parameters_json: HashMap<String, serde_json::Value> = strategy_config
        .parameters
        .iter()
        .map(|(k, v)| {
            let json_value: serde_json::Value = serde_yaml::from_value(v.clone())
                .unwrap_or(serde_json::Value::Null);
            (k.clone(), json_value)
        })
        .collect();

    let strategy_data = StrategyConfigData {
        name: strategy_config.name.clone(),
        dependencies: Dependencies {
            signals: strategy_config.dependencies.signals.clone(),
        },
        entry: entry_json,
        exit: exit_json,
        parameters: parameters_json,
    };

    let input = PythonBacktestInput {
        candles: candle_data,
        strategy_config: strategy_data,
    };

    // Serialize input to JSON
    let input_json = serde_json::to_string(&input)
        .map_err(|e| format!("Failed to serialize input: {}", e))?;

    // Find workspace path (go up from api/ to root/)
    let workspace_path = std::env::current_dir()
        .map_err(|e| format!("Failed to get current dir: {}", e))?
        .parent()
        .ok_or("Failed to find parent directory")?
        .to_path_buf();

    let python_script = workspace_path
        .join("workspace")
        .join("core")
        .join("utils")
        .join("vectorized_backtest_v2.py");

    if !python_script.exists() {
        return Err(format!(
            "Python backtest script not found: {}",
            python_script.display()
        ));
    }

    tracing::info!("Running Python script: {}", python_script.display());

    // Spawn Python process
    let mut child = Command::new("python3")
        .arg(&python_script)
        .current_dir(&workspace_path.join("workspace"))
        .env("PYTHONPATH", workspace_path.join("workspace").to_str().unwrap())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Python process: {}", e))?;

    // Write input to stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input_json.as_bytes())
            .map_err(|e| format!("Failed to write to Python stdin: {}", e))?;
    }

    // Wait for process to complete
    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Python process: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python process failed: {}", stderr));
    }

    // Parse output
    let stdout = String::from_utf8_lossy(&output.stdout);
    tracing::debug!("Python output: {}", stdout);

    let python_output: PythonBacktestOutput = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse Python output: {}\nOutput: {}", e, stdout))?;

    tracing::info!(
        "Python backtest generated {} signals",
        python_output.signals.len()
    );

    // Convert Python signals to our SignalEvent type
    let mut signal_events = Vec::new();
    for py_signal in python_output.signals {
        let timestamp = DateTime::parse_from_rfc3339(&py_signal.timestamp)
            .map_err(|e| format!("Invalid timestamp {}: {}", py_signal.timestamp, e))?
            .with_timezone(&chrono::Utc);

        // Use signal_name from Python output, fallback to signal_type if not present
        let signal_name = py_signal
            .signal_name
            .as_ref()
            .map(|s| s.clone())
            .unwrap_or_else(|| py_signal.signal_type.clone());

        signal_events.push(SignalEvent {
            timestamp,
            signal_name,
            signal_type: py_signal.signal_type,
            strength: py_signal.strength,
            metadata: py_signal.metadata,
        });
    }

    Ok(signal_events)
}
