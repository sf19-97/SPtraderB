#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::env;
use std::fs;
use tokio::sync::{Mutex, RwLock};
use tauri::{State, Builder, Manager, WindowEvent, Emitter, Window};
use tokio::process::{Command, Child};
use std::process::Stdio;
use std::collections::HashMap;
use serde_json;
use chrono::{Datelike, DateTime, Utc};
use tokio::io::BufReader;
use redis::Client as RedisClient;
use dirs;

mod workspace;
mod orders;
mod brokers;
mod execution;
mod database;
mod orchestrator;
mod candle_monitor;
mod market_data;
mod candles;
mod commands {
    pub mod bitcoin_data;
}

use execution::ExecutionEngine;
use market_data::commands::*;
use market_data::{PipelineStatus, DataSource};
use market_data::symbols::CachedMetadata;

// Helper function to save pipeline state on shutdown
async fn save_final_state(engine: Arc<Mutex<market_data::MarketDataEngine>>) -> Result<(), String> {
    let configs = {
        let engine_lock = engine.lock().await;
        let mut configs = Vec::new();
        for (symbol, pipeline) in engine_lock.pipelines.iter() {
            let source_name = match &pipeline.config.source {
                DataSource::Oanda { .. } => "oanda",
                DataSource::Kraken { .. } => "kraken",
                DataSource::Alpaca { .. } => "alpaca",
                DataSource::Dukascopy => "dukascopy",
                DataSource::IBKR { .. } => "ibkr",
                DataSource::Coinbase { .. } => "coinbase",
            };
            
            let status = pipeline.status.lock().await;
            let last_tick_str = match &*status {
                PipelineStatus::Running { last_tick, .. } => 
                    last_tick.map(|t| t.to_rfc3339()),
                _ => None,
            };
            
            configs.push(market_data::commands::PipelineConfig {
                symbol: symbol.clone(),
                source: source_name.to_string(),
                asset_class: format!("{:?}", pipeline.config.asset_class).to_lowercase(),
                added_at: chrono::Utc::now().to_rfc3339(),
                last_tick: last_tick_str,
                profile_id: pipeline.config.profile_id.clone(),
                profile_name: pipeline.config.profile_name.clone(),
            });
        }
        configs
    };
    
    // Save with clean_shutdown flag set to true
    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("sptraderb");
    
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    
    let config_file = market_data::commands::PipelineConfigFile {
        version: 1,
        pipelines: configs,
        saved_at: chrono::Utc::now().to_rfc3339(),
        clean_shutdown: true,  // Mark as clean shutdown
    };
    
    let config_path = config_dir.join("active_pipelines.json");
    let json = serde_json::to_string_pretty(&config_file)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    std::fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    
    Ok(())
}

// Orders module still exists but not used directly anymore
use brokers::{BrokerAPI, oanda::{OandaBroker, OandaConfig}};

#[derive(Clone, Debug, Serialize)]
struct LogEvent {
    timestamp: String,
    level: String,
    message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Candle {
    time: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: i64,  // Note: This is tick_count (number of price updates), not traded volume
}


#[derive(Debug, Serialize, Deserialize)]
struct DatabaseStatus {
    connected: bool,
    database_name: String,
    host: String,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DataRequest {
    symbol: String,
    timeframe: String,
    from: i64,
    to: i64,
}

struct AppState {
    db_pool: Arc<Mutex<sqlx::PgPool>>,
    ingestion_processes: Arc<Mutex<HashMap<String, Child>>>,
    candle_cache: Arc<RwLock<HashMap<String, CachedCandles>>>,
    metadata_cache: Arc<RwLock<HashMap<String, CachedMetadata>>>,
    // Order execution
    broker: Arc<RwLock<Option<Box<dyn BrokerAPI>>>>,
    redis_url: String,
    redis_client: Arc<Mutex<Option<RedisClient>>>,
    execution_engine: Arc<Mutex<Option<ExecutionEngine>>>,
    orders_db: Arc<Mutex<sqlx::SqlitePool>>,
    // Backtest cancellation
    active_backtests: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    // Candle update monitors
    candle_monitors: Arc<Mutex<HashMap<String, Arc<candle_monitor::CandleUpdateMonitor>>>>,
}

#[derive(Clone)]
struct CachedCandles {
    data: Vec<Candle>,
    cached_at: i64,
}


// Helper function to emit log events to frontend
fn emit_log<R: tauri::Runtime>(window: &impl Emitter<R>, level: &str, message: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
    let event = LogEvent {
        timestamp,
        level: level.to_string(),
        message: message.to_string(),
    };
    
    // Still print to console for debugging
    println!("[{}] {}", level, message);
    
    // Emit to frontend
    window.emit("backend-log", &event).ok();
}

#[tauri::command]
async fn fetch_candles(
    request: DataRequest,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<Vec<Candle>, String> {
    // Create cache key
    let cache_key = format!("{}-{}-{}-{}", request.symbol, request.timeframe, request.from, request.to);
    let current_time = chrono::Utc::now().timestamp();
    
    // Try to get from cache first
    {
        let cache = state.candle_cache.read().await;
        if let Some(cached) = cache.get(&cache_key) {
            // Check if cache is still fresh (10 minutes)
            if current_time - cached.cached_at < 600 {
                emit_log(&window, "DEBUG", &format!("[CACHE HIT] Returning cached data for {}", cache_key));
                return Ok(cached.data.clone());
            }
        }
    }
    
    emit_log(&window, "DEBUG", &format!("[CACHE MISS] Fetching from database for {}", cache_key));
    
    let table_name = match request.timeframe.as_str() {
        "15m" => "forex_candles_15m",
        "1h" => "forex_candles_1h",
        "4h" => "forex_candles_4h",
        "12h" => "forex_candles_12h",
        _ => return Err(format!("Invalid timeframe: {}", request.timeframe)),
    };

    let query = format!(
        "SELECT
            time,
            open::FLOAT8 as open,
            high::FLOAT8 as high,
            low::FLOAT8 as low,
            close::FLOAT8 as close,
            tick_count::INT8 as volume  -- Volume is tick count (number of price updates), not traded volume
         FROM {} 
         WHERE symbol = $1
           AND time >= to_timestamp($2)
           AND time <= to_timestamp($3)
         ORDER BY time",
        table_name
    );

    emit_log(&window, "DEBUG", &format!("[FETCH_CANDLES] Query: {}", query));
    emit_log(&window, "DEBUG", &format!("[FETCH_CANDLES] Params: symbol={}, from={}, to={}",
             request.symbol, request.from, request.to));

    let pool = state.db_pool.lock().await;
    let rows = sqlx::query_as::<_, (chrono::DateTime<chrono::Utc>, f64, f64, f64, f64, i64)>(&query)
        .bind(&request.symbol)
        .bind(request.from)
        .bind(request.to)
        .fetch_all(&*pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

    let candles: Vec<Candle> = rows.into_iter().map(|(time, open, high, low, close, volume)| Candle {
        time: time.timestamp(),
        open,
        high,
        low,
        close,
        volume,
    }).collect();
    
    // Update cache with new data
    {
        let mut cache = state.candle_cache.write().await;
        
        // Simple LRU: if cache is full (>10 entries), remove oldest
        if cache.len() >= 10 {
            // Find the oldest entry
            if let Some(oldest_key) = cache.iter()
                .min_by_key(|(_, v)| v.cached_at)
                .map(|(k, _)| k.clone()) {
                cache.remove(&oldest_key);
                emit_log(&window, "DEBUG", &format!("[CACHE EVICT] Removed oldest entry: {}", oldest_key));
            }
        }
        
        cache.insert(cache_key.clone(), CachedCandles {
            data: candles.clone(),
            cached_at: current_time,
        });
        emit_log(&window, "DEBUG", &format!("[CACHE UPDATE] Stored {} candles for {}", candles.len(), cache_key));
    }
    
    Ok(candles)
}

#[derive(Debug, Deserialize)]
struct HierarchicalRequest {
    symbol: String,
    from: i64,
    to: i64,
    detail_level: String,
}

#[derive(Debug, Deserialize)]
struct DataIngestionRequest {
    symbol: String,
    start_date: String,
    end_date: String,
}

#[derive(Debug, Serialize)]
struct DataIngestionResponse {
    success: bool,
    message: String,
}


#[derive(Debug, Deserialize)]
struct DeleteDataRequest {
    symbol: String,
    start_date: Option<String>,
    end_date: Option<String>,
}

#[tauri::command]
async fn check_database_connection(
    state: State<'_, AppState>,
) -> Result<DatabaseStatus, String> {
    let pool = state.db_pool.lock().await;
    
    // Try to execute a simple query to check if connection is alive
    match sqlx::query("SELECT current_database(), inet_server_addr()::text")
        .fetch_one(&*pool)
        .await
    {
        Ok(row) => {
            let db_name: String = row.try_get(0).unwrap_or_else(|_| "unknown".to_string());
            let host: Option<String> = row.try_get(1).ok();
            
            Ok(DatabaseStatus {
                connected: true,
                database_name: db_name,
                host: host.unwrap_or_else(|| "localhost".to_string()),
                error: None,
            })
        },
        Err(e) => {
            Ok(DatabaseStatus {
                connected: false,
                database_name: "forex_trading".to_string(),
                host: "localhost".to_string(),
                error: Some(format!("Connection error: {}", e)),
            })
        }
    }
}

#[tauri::command]
async fn fetch_candles_v2(
    request: HierarchicalRequest,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<Vec<Candle>, String> {
    let start_time = std::time::Instant::now();
    
    emit_log(&window, "DEBUG", &format!("[V2] Fetch request: symbol={}, from={}, to={}, detail={}", 
             request.symbol, request.from, request.to, request.detail_level));

    let query = match request.detail_level.as_str() {
        "4h" => {
            "SELECT 
                EXTRACT(EPOCH FROM (base_time + (h4_idx * interval '4 hours')))::BIGINT as time,
                (array_agg(h4_open ORDER BY m15_idx))[1]::FLOAT8 as open,
                MAX(h4_high)::FLOAT8 as high,
                MIN(h4_low)::FLOAT8 as low,
                (array_agg(h4_close ORDER BY m15_idx DESC))[1]::FLOAT8 as close,
                SUM(tick_count)::BIGINT as volume
             FROM experimental.candle_hierarchy
             WHERE symbol = $1 
             AND base_time + (h4_idx * interval '4 hours') BETWEEN to_timestamp($2) AND to_timestamp($3)
             GROUP BY EXTRACT(EPOCH FROM (base_time + (h4_idx * interval '4 hours')))
             ORDER BY time"
        },
        "1h" => {
            "SELECT 
                EXTRACT(EPOCH FROM (base_time + (h4_idx * interval '4 hours') + (h1_idx * interval '1 hour')))::BIGINT as time,
                (array_agg(h1_open ORDER BY m15_idx))[1]::FLOAT8 as open,
                MAX(h1_high)::FLOAT8 as high,
                MIN(h1_low)::FLOAT8 as low,
                (array_agg(h1_close ORDER BY m15_idx DESC))[1]::FLOAT8 as close,
                SUM(tick_count)::BIGINT as volume
             FROM experimental.candle_hierarchy
             WHERE symbol = $1 
             AND base_time + (h4_idx * interval '4 hours') + (h1_idx * interval '1 hour') 
                 BETWEEN to_timestamp($2) AND to_timestamp($3)
             GROUP BY EXTRACT(EPOCH FROM (base_time + (h4_idx * interval '4 hours') + (h1_idx * interval '1 hour')))
             ORDER BY time"
        },
        "15m" => {
            "SELECT 
                EXTRACT(EPOCH FROM (base_time + (h4_idx * interval '4 hours') + (h1_idx * interval '1 hour') + (m15_idx * interval '15 minutes')))::BIGINT as time,
                m15_open::FLOAT8 as open,
                m15_high::FLOAT8 as high,
                m15_low::FLOAT8 as low,
                m15_close::FLOAT8 as close,
                tick_count::BIGINT as volume
             FROM experimental.candle_hierarchy
             WHERE symbol = $1 
             AND base_time + (h4_idx * interval '4 hours') + (h1_idx * interval '1 hour') + (m15_idx * interval '15 minutes')
                 BETWEEN to_timestamp($2) AND to_timestamp($3)
             ORDER BY time"
        },
        _ => return Err(format!("Invalid detail level: {}", request.detail_level)),
    };

    emit_log(&window, "DEBUG", &format!("[V2] Query: {}", query));

    let pool = state.db_pool.lock().await;
    let rows = sqlx::query_as::<_, (i64, f64, f64, f64, f64, i64)>(&query)
        .bind(&request.symbol)
        .bind(request.from)
        .bind(request.to)
        .fetch_all(&*pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

    let candles: Vec<Candle> = rows.into_iter().map(|(time, open, high, low, close, volume)| Candle {
        time,
        open,
        high,
        low,
        close,
        volume,
    }).collect();

    let duration = start_time.elapsed();
    emit_log(&window, "PERF", &format!("Fetched {} candles in {}ms", candles.len(), duration.as_millis()));

    Ok(candles)
}

#[tauri::command]
async fn start_data_ingestion(
    request: DataIngestionRequest,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    window: tauri::Window,
) -> Result<DataIngestionResponse, String> {
    emit_log(&window, "INFO", &format!("Starting ingestion for {} from {} to {}", 
             request.symbol, request.start_date, request.end_date));

    // Check if there's already a process running for this symbol
    {
        let processes = state.ingestion_processes.lock().await;
        if processes.contains_key(&request.symbol) {
            return Ok(DataIngestionResponse {
                success: false,
                message: format!("Ingestion already in progress for {}", request.symbol),
            });
        }
    }

    // Get the path to the Python script
    let script_path = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {}", e))?
        .parent()  // Go up from src-tauri to project root
        .ok_or("Failed to get parent directory")?
        .join("data-ingestion")
        .join("dukascopy_ingester.py");

    emit_log(&window, "INFO", &format!("Script path: {:?}", script_path));

    // Check if the script exists
    if !script_path.exists() {
        return Ok(DataIngestionResponse {
            success: false,
            message: format!("Python script not found at: {:?}", script_path),
        });
    }

    // Prepare the command
    let mut cmd = Command::new("python3");
    cmd.arg(script_path)
        .arg("--symbol")
        .arg(&request.symbol)
        .arg("--start-date")
        .arg(&request.start_date)
        .arg("--end-date")
        .arg(&request.end_date)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    emit_log(&window, "INFO", "Spawning Python process...");

    // Spawn the process instead of waiting for it
    match cmd.spawn() {
        Ok(child) => {
            let symbol = request.symbol.clone();
            let app_handle_clone = app_handle.clone();
            let ingestion_processes = state.ingestion_processes.clone();
            
            // Store the process first
            {
                let mut processes = ingestion_processes.lock().await;
                processes.insert(symbol.clone(), child);
            }
            
            // Emit started event
            app_handle.emit("ingestion-started", &symbol)
                .map_err(|e| format!("Failed to emit event: {}", e))?;
            
            // Clone window for the monitoring task
            let window_clone = window.clone();
            
            // Spawn a task to monitor the process
            tokio::spawn(async move {
                let symbol_for_monitoring = symbol.clone();
                
                // Wait a moment to ensure the process is stored
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                
                // Get the child process
                let mut child_process = {
                    let mut processes = ingestion_processes.lock().await;
                    processes.remove(&symbol).unwrap()
                };
                
                // Take stdout and stderr
                let stdout = child_process.stdout.take();
                let stderr = child_process.stderr.take();
                
                // Clone window for output tasks
                let window_stdout = window_clone.clone();
                let window_stderr = window_clone.clone();
                let window_progress = window_clone.clone();
                let window_progress_stderr = window_clone.clone();
                let symbol_stdout = symbol.clone();
                let _symbol_stderr = symbol.clone();
                let symbol_progress = symbol.clone();
                
                // Spawn task to read stdout
                let stdout_task = if let Some(stdout) = stdout {
                    let handle = tokio::spawn(async move {
                        let reader = BufReader::new(stdout);
                        use tokio::io::AsyncBufReadExt;
                        let mut lines = reader.lines();
                        
                        while let Some(line) = lines.next_line().await.ok().flatten() {
                            // Check if it's a progress bar line (contains % and |)
                            if line.contains('%') && line.contains('|') && line.contains('[') {
                                // Parse progress percentage
                                if let Some(percent_pos) = line.find('%') {
                                    // Look backwards from % to find the number
                                    let prefix = &line[..percent_pos];
                                    if let Some(number_start) = prefix.rfind(' ') {
                                        if let Ok(progress) = prefix[number_start+1..].parse::<f32>() {
                                            // Emit progress event
                                            window_progress.emit("ingestion-progress", serde_json::json!({
                                                "symbol": symbol_stdout,
                                                "progress": progress
                                            })).ok();
                                        }
                                    }
                                }
                            }
                            
                            // Always emit as log (remove carriage returns)
                            let clean_line = line.replace('\r', "");
                            emit_log(&window_stdout, "PYTHON", &clean_line);
                        }
                    });
                    Some(handle)
                } else {
                    None
                };
                
                // Spawn task to read stderr
                let stderr_task = if let Some(stderr) = stderr {
                    let handle = tokio::spawn(async move {
                        let reader = BufReader::new(stderr);
                        use tokio::io::AsyncBufReadExt;
                        let mut lines = reader.lines();
                        
                        while let Some(line) = lines.next_line().await.ok().flatten() {
                            // Check if it's a progress bar line (contains % and |)
                            if line.contains('%') && line.contains('|') && line.contains('[') {
                                // Parse progress percentage
                                if let Some(percent_pos) = line.find('%') {
                                    // Look backwards from % to find the number
                                    let prefix = &line[..percent_pos];
                                    if let Some(number_start) = prefix.rfind(' ') {
                                        if let Ok(progress) = prefix[number_start+1..].parse::<f32>() {
                                            // Emit progress event
                                            window_progress_stderr.emit("ingestion-progress", serde_json::json!({
                                                "symbol": symbol_progress,
                                                "progress": progress
                                            })).ok();
                                        }
                                    }
                                }
                            }
                            
                            // Check if it's an actual error or just stderr output
                            let is_error = line.contains(" - ERROR - ") || 
                                          line.contains(" - CRITICAL - ") || 
                                          line.contains("Traceback") || 
                                          line.contains("Exception:") ||
                                          line.contains("Error:") ||
                                          line.contains("Failed to");
                            
                            // Clean up the line (remove extra whitespace and carriage returns)
                            let clean_line = line.replace('\r', "").trim().to_string();
                            
                            // Skip empty lines
                            if clean_line.is_empty() {
                                continue;
                            }
                            
                            if is_error {
                                emit_log(&window_stderr, "ERROR", &clean_line);
                            } else {
                                // Most stderr output from Python (logging, tqdm) is not errors
                                emit_log(&window_stderr, "PYTHON", &clean_line);
                            }
                        }
                    });
                    Some(handle)
                } else {
                    None
                };
                
                // Wait for the process to complete
                match child_process.wait().await {
                    Ok(status) => {
                        // Wait for output tasks to complete
                        if let Some(task) = stdout_task {
                            task.await.ok();
                        }
                        if let Some(task) = stderr_task {
                            task.await.ok();
                        }
                        
                        if status.success() {
                            emit_log(&window_clone, "SUCCESS", &format!("Process completed successfully for {}", symbol_for_monitoring));
                            app_handle_clone.emit("ingestion-completed", &symbol_for_monitoring).ok();
                        } else {
                            emit_log(&window_clone, "ERROR", &format!("Process failed for {}", symbol_for_monitoring));
                            app_handle_clone.emit("ingestion-failed", &symbol_for_monitoring).ok();
                        }
                    },
                    Err(e) => {
                        emit_log(&window_clone, "ERROR", &format!("Error waiting for process: {}", e));
                        app_handle_clone.emit("ingestion-failed", &symbol_for_monitoring).ok();
                    }
                }
                
                // Remove from active processes (in case it wasn't removed above)
                let mut processes = ingestion_processes.lock().await;
                processes.remove(&symbol_for_monitoring);
            });
            
            Ok(DataIngestionResponse {
                success: true,
                message: format!("Started ingestion for {} in background", request.symbol),
            })
        },
        Err(e) => {
            Ok(DataIngestionResponse {
                success: false,
                message: format!("Failed to start Python script: {}. Make sure Python 3 is installed.", e),
            })
        }
    }
}

#[tauri::command]
async fn cancel_ingestion(
    symbol: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    window: tauri::Window,
) -> Result<bool, String> {
    emit_log(&window, "INFO", &format!("Cancelling ingestion for {}", symbol));
    
    let mut processes = state.ingestion_processes.lock().await;
    
    if let Some(mut child) = processes.remove(&symbol) {
        // Try to kill the process
        match child.kill().await {
            Ok(_) => {
                emit_log(&window, "SUCCESS", &format!("Successfully killed process for {}", symbol));
                
                // Emit cancelled event
                app_handle.emit("ingestion-cancelled", &symbol)
                    .map_err(|e| format!("Failed to emit event: {}", e))?;
                
                Ok(true)
            },
            Err(e) => {
                emit_log(&window, "ERROR", &format!("Failed to kill process: {}", e));
                Err(format!("Failed to cancel ingestion: {}", e))
            }
        }
    } else {
        emit_log(&window, "WARN", &format!("No process found for {}", symbol));
        Ok(false)
    }
}

#[tauri::command]
async fn get_ingestion_status(
    symbol: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let processes = state.ingestion_processes.lock().await;
    Ok(processes.contains_key(&symbol))
}

#[tauri::command]
async fn delete_data_range(
    request: DeleteDataRequest,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<bool, String> {
    emit_log(&window, "INFO", &format!("Request to delete {} data from {:?} to {:?}", 
             request.symbol, request.start_date, request.end_date));
    
    let pool = state.db_pool.lock().await;
    
    // Start a transaction for atomicity
    let mut tx = pool.begin().await
        .map_err(|e| format!("Failed to start transaction: {}", e))?;
    
    // Build WHERE clause based on provided dates
    let where_clause = match (&request.start_date, &request.end_date) {
        (Some(_start), Some(_end)) => {
            format!("WHERE symbol = $1 AND time >= $2::date AND time <= $3::date + interval '1 day'")
        },
        (Some(_start), None) => {
            format!("WHERE symbol = $1 AND time >= $2::date")
        },
        (None, Some(_end)) => {
            format!("WHERE symbol = $1 AND time <= $2::date + interval '1 day'")
        },
        (None, None) => {
            format!("WHERE symbol = $1")
        },
    };
    
    // Delete from all tables
    let tables = vec![
        "forex_ticks",
        "forex_candles_15m",
        "forex_candles_1h",
        "forex_candles_4h",
        "forex_candles_12h",
    ];
    
    let mut total_deleted = 0i64;
    
    for table in tables {
        let query = format!("DELETE FROM {} {}", table, where_clause);
        
        let result = match (&request.start_date, &request.end_date) {
            (Some(start), Some(end)) => {
                sqlx::query(&query)
                    .bind(&request.symbol)
                    .bind(start)
                    .bind(end)
                    .execute(&mut *tx)
                    .await
            },
            (Some(start), None) => {
                sqlx::query(&query)
                    .bind(&request.symbol)
                    .bind(start)
                    .execute(&mut *tx)
                    .await
            },
            (None, Some(end)) => {
                sqlx::query(&query)
                    .bind(&request.symbol)
                    .bind(end)
                    .execute(&mut *tx)
                    .await
            },
            (None, None) => {
                sqlx::query(&query)
                    .bind(&request.symbol)
                    .execute(&mut *tx)
                    .await
            },
        };
        
        match result {
            Ok(query_result) => {
                let rows_affected = query_result.rows_affected();
                emit_log(&window, "INFO", &format!("Deleted {} rows from {}", rows_affected, table));
                total_deleted += rows_affected as i64;
            },
            Err(e) => {
                // Rollback transaction on error
                tx.rollback().await.ok();
                return Err(format!("Failed to delete from {}: {}", table, e));
            }
        }
    }
    
    // Commit transaction
    tx.commit().await
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;
    
    emit_log(&window, "SUCCESS", &format!("Successfully deleted {} total rows", total_deleted));
    Ok(true)
}

#[derive(Debug, Deserialize)]
struct RefreshCandlesRequest {
    symbol: String,
    _start_date: String,
    _end_date: String,
}

#[tauri::command]
async fn refresh_candles(
    request: RefreshCandlesRequest,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<bool, String> {
    emit_log(&window, "INFO", &format!("Starting smart refresh for {}", request.symbol));
    
    let pool = state.db_pool.lock().await;
    
    // Get the last refresh timestamp and newest tick timestamp
    let metadata_query = r#"
        SELECT 
            COALESCE(m.last_refresh_timestamp, '1970-01-01'::timestamptz) as last_refresh,
            MAX(t.time) as newest_tick,
            MIN(t.time) as oldest_tick
        FROM forex_ticks t
        LEFT JOIN candle_refresh_metadata m ON m.symbol = t.symbol
        WHERE t.symbol = $1
        GROUP BY m.last_refresh_timestamp
    "#;
    
    let row = sqlx::query(metadata_query)
        .bind(&request.symbol)
        .fetch_one(&*pool)
        .await
        .map_err(|e| format!("Failed to get metadata: {}", e))?;
    
    let last_refresh: chrono::DateTime<chrono::Utc> = row.try_get("last_refresh")
        .map_err(|e| format!("Failed to get last_refresh: {}", e))?;
    let newest_tick: chrono::DateTime<chrono::Utc> = row.try_get("newest_tick")
        .map_err(|e| format!("Failed to get newest_tick: {}", e))?;
    let oldest_tick: chrono::DateTime<chrono::Utc> = row.try_get("oldest_tick")
        .map_err(|e| format!("Failed to get oldest_tick: {}", e))?;
    
    // Determine the refresh range
    let refresh_start = if last_refresh.timestamp() > 0 {
        // Start from last refresh, but go back 1 hour to ensure overlap
        last_refresh - chrono::Duration::hours(1)
    } else {
        // First time refresh - use the oldest tick date
        oldest_tick
    };
    
    let refresh_end = newest_tick + chrono::Duration::hours(1); // Add buffer
    
    // Ensure refresh_start is not after refresh_end (can happen if metadata is stale)
    let refresh_start = if refresh_start > refresh_end {
        emit_log(&window, "WARN", &format!("Invalid range detected: start {} > end {}", 
                 refresh_start.format("%Y-%m-%d %H:%M:%S"),
                 refresh_end.format("%Y-%m-%d %H:%M:%S")));
        emit_log(&window, "INFO", "Resetting to full range from oldest tick");
        oldest_tick
    } else {
        refresh_start
    };
    
    emit_log(&window, "INFO", &format!("Total refresh range: {} to {}", 
             refresh_start.format("%Y-%m-%d %H:%M:%S"),
             refresh_end.format("%Y-%m-%d %H:%M:%S")));
    
    // Calculate total duration
    let total_duration = refresh_end - refresh_start;
    let days = total_duration.num_days();
    
    // If the range is too large (more than 60 days), process in monthly chunks
    if days > 60 {
        emit_log(&window, "INFO", &format!("Large range detected ({} days), processing in monthly chunks", days));
        
        // List of continuous aggregates to refresh
        let aggregates = vec![
            ("forex_candles_5m", "5 minutes"),
            ("forex_candles_15m", "15 minutes"),
            ("forex_candles_1h", "1 hour"),
            ("forex_candles_4h", "4 hours"),
            ("forex_candles_12h", "12 hours"),
        ];
        
        // Process each aggregate type
        for (idx, (aggregate_name, description)) in aggregates.iter().enumerate() {
            emit_log(&window, "CANDLES", &format!("Processing {} candles in chunks...", description));
            
            let base_progress = idx * 20; // Each aggregate gets 20% of progress
            
            // Process in monthly chunks
            let mut chunk_start = refresh_start;
            let mut chunk_count = 0;
            let total_months = ((refresh_end.year() - refresh_start.year()) * 12 + 
                               (refresh_end.month() as i32 - refresh_start.month() as i32)) as usize + 1;
            
            while chunk_start < refresh_end {
                // Calculate chunk end (1 month later or refresh_end, whichever is earlier)
                let chunk_end = std::cmp::min(
                    chunk_start + chrono::Duration::days(30),
                    refresh_end
                );
                
                // Calculate progress for this chunk
                let chunk_progress = base_progress + (20 * chunk_count / total_months);
                
                // Emit progress
                window.emit("candle-refresh-progress", serde_json::json!({
                    "symbol": request.symbol,
                    "progress": chunk_progress,
                    "stage": format!("Generating {} candles: {} to {}", 
                                   description,
                                   chunk_start.format("%Y-%m-%d"),
                                   chunk_end.format("%Y-%m-%d"))
                })).ok();
                
                let query = format!(
                    "CALL refresh_continuous_aggregate('{}', '{}', '{}')",
                    aggregate_name, 
                    chunk_start.format("%Y-%m-%d %H:%M:%S"),
                    chunk_end.format("%Y-%m-%d %H:%M:%S")
                );
                
                match sqlx::query(&query).execute(&*pool).await {
                    Ok(_) => {
                        emit_log(&window, "SUCCESS", &format!("Successfully refreshed {} chunk: {} to {}", 
                                 aggregate_name, 
                                 chunk_start.format("%Y-%m-%d"),
                                 chunk_end.format("%Y-%m-%d")));
                    },
                    Err(e) => {
                        emit_log(&window, "ERROR", &format!("Failed to refresh {} chunk: {}", aggregate_name, e));
                        return Err(format!("Failed to refresh {}: {}", aggregate_name, e));
                    }
                }
                
                // Move to next chunk
                chunk_start = chunk_end;
                chunk_count += 1;
            }
        }
    } else {
        // Small range, process normally
        emit_log(&window, "INFO", &format!("Processing normally (range: {} days)", days));
        
        // Emit progress event
        window.emit("candle-refresh-progress", serde_json::json!({
            "symbol": request.symbol,
            "progress": 0,
            "stage": "Starting refresh"
        })).ok();
        
        // List of continuous aggregates to refresh
        let aggregates = vec![
            ("forex_candles_5m", "5 minutes", 20),
            ("forex_candles_15m", "15 minutes", 40),
            ("forex_candles_1h", "1 hour", 60),
            ("forex_candles_4h", "4 hours", 80),
            ("forex_candles_12h", "12 hours", 95),
        ];
        
        // Refresh each continuous aggregate
        for (aggregate_name, description, progress) in aggregates {
            emit_log(&window, "CANDLES", &format!("Refreshing {} candles...", description));
            
            // Emit progress
            window.emit("candle-refresh-progress", serde_json::json!({
                "symbol": request.symbol,
                "progress": progress,
                "stage": format!("Generating {} candles", description)
            })).ok();
            
            let query = format!(
                "CALL refresh_continuous_aggregate('{}', '{}', '{}')",
                aggregate_name, 
                refresh_start.format("%Y-%m-%d %H:%M:%S"),
                refresh_end.format("%Y-%m-%d %H:%M:%S")
            );
            
            match sqlx::query(&query).execute(&*pool).await {
                Ok(_) => {
                    emit_log(&window, "SUCCESS", &format!("Successfully refreshed {}", aggregate_name));
                },
                Err(e) => {
                    emit_log(&window, "ERROR", &format!("Failed to refresh {}: {}", aggregate_name, e));
                    return Err(format!("Failed to refresh {}: {}", aggregate_name, e));
                }
            }
        }
    }
    
    // Update metadata
    let update_metadata_query = r#"
        INSERT INTO candle_refresh_metadata (symbol, last_refresh_timestamp, last_tick_timestamp, updated_at)
        VALUES ($1, NOW(), $2, NOW())
        ON CONFLICT (symbol) 
        DO UPDATE SET 
            last_refresh_timestamp = NOW(),
            last_tick_timestamp = $2,
            updated_at = NOW()
    "#;
    
    sqlx::query(update_metadata_query)
        .bind(&request.symbol)
        .bind(&newest_tick)
        .execute(&*pool)
        .await
        .map_err(|e| format!("Failed to update metadata: {}", e))?;
    
    // Emit completion
    window.emit("candle-refresh-progress", serde_json::json!({
        "symbol": request.symbol,
        "progress": 100,
        "stage": "Complete"
    })).ok();
    
    // Clear cache for this symbol since data has been refreshed
    {
        let mut cache = state.candle_cache.write().await;
        let keys_to_remove: Vec<String> = cache.keys()
            .filter(|k| k.starts_with(&format!("{}-", request.symbol)))
            .cloned()
            .collect();
        
        for key in keys_to_remove {
            cache.remove(&key);
            emit_log(&window, "DEBUG", &format!("[CACHE CLEAR] Removed {} after refresh", key));
        }
    }
    
    emit_log(&window, "SUCCESS", "All candles refreshed successfully");
    Ok(true)
}


#[derive(Debug, Deserialize)]
struct ExportDataRequest {
    symbol: String,
    timeframe: String,
    start_date: String,
    end_date: String,
    filename: String,
}

#[tauri::command]
async fn export_test_data(
    request: ExportDataRequest,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    emit_log(&window, "INFO", &format!("Exporting test data: {} {} from {} to {}", 
        request.symbol, request.timeframe, request.start_date, request.end_date));
    
    let pool = state.db_pool.lock().await;
    
    // Determine table based on timeframe
    let table_name = match request.timeframe.as_str() {
        "5m" => "forex_candles_5m",
        "15m" => "forex_candles_15m",
        "1h" => "forex_candles_1h",
        "4h" => "forex_candles_4h",
        "12h" => "forex_candles_12h",
        _ => return Err(format!("Invalid timeframe: {}", request.timeframe)),
    };
    
    // Query data
    let query = format!(
        "SELECT 
            time,
            open::FLOAT8 as open,
            high::FLOAT8 as high,
            low::FLOAT8 as low,
            close::FLOAT8 as close,
            tick_count::BIGINT as volume
        FROM {}
        WHERE symbol = $1 
            AND time >= $2::timestamp 
            AND time <= $3::timestamp
        ORDER BY time",
        table_name
    );
    
    let rows = sqlx::query(&query)
        .bind(&request.symbol)
        .bind(&request.start_date)
        .bind(&request.end_date)
        .fetch_all(&*pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    
    if rows.is_empty() {
        return Err("No data found for the specified range".to_string());
    }
    
    emit_log(&window, "INFO", &format!("Found {} rows to export", rows.len()));
    
    // Convert to simple format for Python
    let mut times = Vec::new();
    let mut opens = Vec::new();
    let mut highs = Vec::new();
    let mut lows = Vec::new();
    let mut closes = Vec::new();
    let mut volumes = Vec::new();
    
    for row in rows {
        let time: DateTime<Utc> = row.try_get("time").map_err(|e| format!("Failed to get time: {}", e))?;
        times.push(time.format("%Y-%m-%d %H:%M:%S").to_string());
        opens.push(row.try_get::<f64, _>("open").map_err(|e| format!("Failed to get open: {}", e))?);
        highs.push(row.try_get::<f64, _>("high").map_err(|e| format!("Failed to get high: {}", e))?);
        lows.push(row.try_get::<f64, _>("low").map_err(|e| format!("Failed to get low: {}", e))?);
        closes.push(row.try_get::<f64, _>("close").map_err(|e| format!("Failed to get close: {}", e))?);
        volumes.push(row.try_get::<i64, _>("volume").map_err(|e| format!("Failed to get volume: {}", e))?);
    }
    
    // Create DataFrame-like structure for Parquet
    use arrow::array::{StringArray, Float64Array, Int64Array};
    use arrow::datatypes::{DataType, Field, Schema};
    use arrow::record_batch::RecordBatch;
    use parquet::arrow::ArrowWriter;
    use std::sync::Arc;
    
    // Create Arrow arrays
    let time_array = StringArray::from(times.clone());
    let open_array = Float64Array::from(opens.clone());
    let high_array = Float64Array::from(highs.clone());
    let low_array = Float64Array::from(lows.clone());
    let close_array = Float64Array::from(closes.clone());
    let volume_array = Int64Array::from(volumes.clone());
    
    // Define schema
    let schema = Arc::new(Schema::new(vec![
        Field::new("time", DataType::Utf8, false),
        Field::new("open", DataType::Float64, false),
        Field::new("high", DataType::Float64, false),
        Field::new("low", DataType::Float64, false),
        Field::new("close", DataType::Float64, false),
        Field::new("volume", DataType::Int64, false),
    ]));
    
    // Create record batch
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(time_array),
            Arc::new(open_array),
            Arc::new(high_array),
            Arc::new(low_array),
            Arc::new(close_array),
            Arc::new(volume_array),
        ],
    ).map_err(|e| format!("Failed to create record batch: {}", e))?;
    
    // Save to workspace/data directory
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace")
        .join("data");
    
    // Create data directory if it doesn't exist
    fs::create_dir_all(&workspace_path)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;
    
    // Change extension to .parquet
    let parquet_filename = request.filename.replace(".csv", ".parquet");
    let file_path = workspace_path.join(&parquet_filename);
    
    // Write Parquet file
    let file = fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    let mut writer = ArrowWriter::try_new(file, schema, None)
        .map_err(|e| format!("Failed to create parquet writer: {}", e))?;
    writer.write(&batch)
        .map_err(|e| format!("Failed to write batch: {}", e))?;
    writer.close()
        .map_err(|e| format!("Failed to close writer: {}", e))?;
    
    emit_log(&window, "SUCCESS", &format!("Exported {} rows to {}", times.len(), parquet_filename));
    
    Ok(file_path.to_string_lossy().to_string())
}

// test_order_execution command removed - orders handled by orchestrator

// Test orchestrator strategy loading
#[tauri::command]
async fn test_orchestrator_load(
    strategy_name: String,
    window: tauri::Window,
) -> Result<serde_json::Value, String> {
    emit_log(&window, "INFO", &format!("Loading strategy: {}", strategy_name));
    
    // Get the workspace path
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace")
        .join("strategies")
        .join(format!("{}.yaml", strategy_name));
    
    // Try to load the strategy
    match orchestrator::Orchestrator::load_strategy(workspace_path.to_str().unwrap()) {
        Ok(orchestrator) => {
            let config = orchestrator.get_config();
            let summary = orchestrator.get_summary();
            
            emit_log(&window, "SUCCESS", &format!("Loaded strategy: {}", config.name));
            emit_log(&window, "INFO", &summary);
            
            Ok(serde_json::json!({
                "success": true,
                "strategy": {
                    "name": config.name,
                    "version": config.version,
                    "author": config.author,
                    "description": config.description,
                    "indicators": config.dependencies.indicators,
                    "signals": config.dependencies.signals,
                    "parameter_count": config.parameters.len(),
                    "risk_rules": config.risk.len()
                },
                "summary": summary
            }))
        }
        Err(e) => {
            emit_log(&window, "ERROR", &format!("Failed to load strategy: {}", e));
            Err(format!("Failed to load strategy: {}", e))
        }
    }
}

// Run a simple backtest
#[tauri::command]
async fn run_orchestrator_backtest(
    strategy_name: String,
    symbol: String,
    timeframe: String,
    start_date: String,
    end_date: String,
    initial_capital: f64,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<serde_json::Value, String> {
    emit_log(&window, "INFO", &format!("Starting backtest for strategy: {}", strategy_name));
    
    // Generate unique backtest ID
    let backtest_id = uuid::Uuid::new_v4().to_string();
    emit_log(&window, "DEBUG", &format!("Backtest ID: {}", backtest_id));
    
    // Create cancellation token
    let cancel_token = Arc::new(AtomicBool::new(false));
    
    // Store the cancellation token
    {
        let mut active_backtests = state.active_backtests.lock().await;
        active_backtests.insert(backtest_id.clone(), cancel_token.clone());
    }
    
    // Load the strategy
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace")
        .join("strategies")
        .join(format!("{}.yaml", strategy_name));
    
    let mut orchestrator = orchestrator::Orchestrator::load_strategy(workspace_path.to_str().unwrap())
        .map_err(|e| format!("Failed to load strategy: {}", e))?;
    
    // Parse dates
    let from = chrono::DateTime::parse_from_rfc3339(&start_date)
        .map_err(|e| format!("Failed to parse start date: {}", e))?
        .with_timezone(&chrono::Utc);
    let to = chrono::DateTime::parse_from_rfc3339(&end_date)
        .map_err(|e| format!("Failed to parse end date: {}", e))?
        .with_timezone(&chrono::Utc);
    
    // Create data source - always use Live which will utilize cache/database intelligently
    emit_log(&window, "INFO", &format!("Using {} {} data from {} to {}", 
        symbol, timeframe, from.format("%Y-%m-%d"), to.format("%Y-%m-%d")));
    
    let data_source = orchestrator::DataSource::Live {
        symbol,
        timeframe,
        from,
        to,
    };
    
    // Run the backtest
    let initial_capital = rust_decimal::Decimal::from_str(&initial_capital.to_string())
        .map_err(|_| "Invalid initial capital")?;
    emit_log(&window, "INFO", &format!("Running backtest with initial capital: ${}", initial_capital));
    
    // Return the backtest ID immediately so the frontend can use it for cancellation
    window.emit("backtest_started", serde_json::json!({
        "backtest_id": backtest_id.clone()
    })).ok();
    
    let backtest_id_clone = backtest_id.clone();
    let result = match orchestrator.run_backtest_vectorized(data_source, initial_capital, &window, Some(cancel_token)).await {
        Ok(result) => {
            // Debug: Log data sizes
            emit_log(&window, "DEBUG", &format!("Signals: {}, Orders: {}, Trades: {}", 
                result.signals_generated.len(),
                result.executed_orders.len(),
                result.completed_trades.len()
            ));
            emit_log(&window, "SUCCESS", "Backtest completed successfully");
            
            // Limit the data sent to frontend to prevent UI freeze
            let limited_signals = if result.signals_generated.len() > 100 {
                emit_log(&window, "WARN", &format!("Limiting signals from {} to 100 for UI performance", result.signals_generated.len()));
                result.signals_generated.into_iter().take(100).collect()
            } else {
                result.signals_generated
            };
            
            Ok(serde_json::json!({
                "success": true,
                "backtest_id": backtest_id_clone,
                "result": {
                    "total_trades": result.total_trades,
                    "winning_trades": result.winning_trades,
                    "losing_trades": result.losing_trades,
                    "total_pnl": result.total_pnl.to_string(),
                    "max_drawdown": result.max_drawdown.to_string(),
                    "sharpe_ratio": result.sharpe_ratio,
                    "start_capital": result.start_capital.to_string(),
                    "end_capital": result.end_capital.to_string(),
                    "signals_generated": limited_signals,
                    "completed_trades": result.completed_trades.into_iter().take(100).collect::<Vec<_>>(),
                    "executed_orders": result.executed_orders.into_iter().take(100).collect::<Vec<_>>(),
                    "final_portfolio": result.final_portfolio,
                    "daily_returns": result.daily_returns.into_iter().take(100).collect::<Vec<_>>(),
                    "indicator_data": result.indicator_data
                }
            }))
        }
        Err(e) => {
            emit_log(&window, "ERROR", &format!("Backtest failed: {}", e));
            Err(format!("Backtest failed: {}", e))
        }
    };
    
    // Clean up the cancellation token
    {
        let mut active_backtests = state.active_backtests.lock().await;
        active_backtests.remove(&backtest_id);
    }
    
    result
}

// Cancel a running backtest
#[tauri::command]
async fn cancel_backtest(
    backtest_id: String,
    state: State<'_, AppState>,
    window: Window,
) -> Result<(), String> {
    let active_backtests = state.active_backtests.lock().await;
    
    if let Some(cancel_token) = active_backtests.get(&backtest_id) {
        cancel_token.store(true, Ordering::Relaxed);
        emit_log(&window, "INFO", &format!("Cancelling backtest {}", backtest_id));
        Ok(())
    } else {
        Err(format!("Backtest {} not found or already completed", backtest_id))
    }
}

// Run orchestrator in live mode
#[tauri::command]
async fn run_orchestrator_live(
    strategy_name: String,
    initial_capital: Option<f64>,
    state: State<'_, AppState>,
    window: Window,
) -> Result<serde_json::Value, String> {
    emit_log(&window, "INFO", &format!("Starting orchestrator live mode for strategy: {}", strategy_name));
    
    // Load the strategy
    let strategy_path = format!("workspace/strategies/{}.yaml", strategy_name);
    let orchestrator = match orchestrator::Orchestrator::load_strategy(&strategy_path) {
        Ok(o) => o,
        Err(e) => {
            emit_log(&window, "ERROR", &format!("Failed to load strategy: {}", e));
            return Err(format!("Failed to load strategy: {}", e));
        }
    };
    
    let initial_capital = rust_decimal::Decimal::from_str(&initial_capital.unwrap_or(10000.0).to_string())
        .unwrap_or(rust_decimal::Decimal::from(10000));
    
    emit_log(&window, "INFO", &format!("Starting live trading with initial capital: ${}", initial_capital));
    
    // Spawn the live trading task
    let redis_url = state.redis_url.clone();
    tokio::spawn(async move {
        match orchestrator.run_live_mode(&redis_url, initial_capital, &window).await {
            Ok(_) => {
                emit_log(&window, "INFO", "Live trading stopped");
            }
            Err(e) => {
                emit_log(&window, "ERROR", &format!("Live trading error: {}", e));
            }
        }
    });
    
    Ok(serde_json::json!({
        "success": true,
        "message": "Live trading started"
    }))
}

// Get broker connection status
#[tauri::command]
async fn get_broker_connection_status(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let broker_guard = state.broker.read().await;
    
    if let Some(broker) = broker_guard.as_ref() {
        let connected = broker.is_connected();
        let latency = if connected {
            match broker.ping().await {
                Ok(duration) => duration.as_millis() as u64,
                Err(_) => 0,
            }
        } else {
            0
        };
        
        Ok(serde_json::json!({
            "connected": connected,
            "latency_ms": latency,
            "broker_type": "oanda"
        }))
    } else {
        Ok(serde_json::json!({
            "connected": false,
            "latency_ms": 0,
            "broker_type": "mock"
        }))
    }
}

// Initialize broker with profile (called when dropdown selection changes)
#[tauri::command]
async fn init_broker_from_profile(
    broker_type: String,
    api_key: String,
    account_id: String,
    environment: Option<String>,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    emit_log(&window, "INFO", &format!("Initializing {} broker...", broker_type));
    
    match broker_type.as_str() {
        "oanda" => {
            // Determine API URL based on environment
            let env = environment.unwrap_or("demo".to_string());
            let api_url = match env.as_str() {
                "live" => "https://api-fxtrade.oanda.com",
                "demo" | "practice" => "https://api-fxpractice.oanda.com",
                _ => "https://api-fxpractice.oanda.com" // Default to practice
            };
            
            // Debug logging
            emit_log(&window, "DEBUG", &format!("API URL: {}", api_url));
            emit_log(&window, "DEBUG", &format!("Account ID: {}", account_id));
            emit_log(&window, "DEBUG", &format!("API Key length: {}", api_key.len()));
            emit_log(&window, "DEBUG", &format!("API Key preview: {}...{}", 
                &api_key.chars().take(8).collect::<String>(),
                &api_key.chars().rev().take(4).collect::<String>().chars().rev().collect::<String>()
            ));
            
            let config = OandaConfig {
                api_url: api_url.to_string(),
                account_id: account_id.clone(),
                api_token: api_key.clone(),
                practice: env != "live",
            };
            
            let mut oanda_broker = OandaBroker::new(config.clone());
            
            // Test connection
            match oanda_broker.connect().await {
                Ok(_) => {
                    emit_log(&window, "SUCCESS", "Connected to Oanda successfully");
                    
                    // Store the broker
                    let mut broker_guard = state.broker.write().await;
                    *broker_guard = Some(Box::new(oanda_broker));
                    
                    // Now initialize ExecutionEngine with the same broker config
                    emit_log(&window, "INFO", "Initializing ExecutionEngine with Oanda broker...");
                    
                    // Create another instance for ExecutionEngine
                    let mut engine_broker = OandaBroker::new(config.clone());
                    match engine_broker.connect().await {
                        Ok(_) => {
                            match init_execution_engine_with_broker(Box::new(engine_broker), config, &state, &window).await {
                                Ok(_) => {
                                    emit_log(&window, "SUCCESS", "ExecutionEngine initialized with Oanda broker");
                                }
                                Err(e) => {
                                    emit_log(&window, "ERROR", &format!("Failed to initialize ExecutionEngine: {}", e));
                                }
                            }
                        }
                        Err(e) => {
                            emit_log(&window, "ERROR", &format!("Failed to connect engine broker: {}", e));
                        }
                    }
                    
                    Ok("Oanda broker initialized".to_string())
                }
                Err(e) => {
                    emit_log(&window, "ERROR", &format!("Failed to connect to Oanda: {}", e));
                    Err(format!("Failed to connect to Oanda: {}", e))
                }
            }
        }
        _ => Err(format!("Unsupported broker type: {}", broker_type))
    }
}

// Get recent orders from database
#[tauri::command]
async fn get_recent_orders(
    limit: i32,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db = state.orders_db.lock().await;
    
    match database::orders::get_recent_orders(&*db, limit).await {
        Ok(orders) => {
            let json_orders: Vec<serde_json::Value> = orders.into_iter()
                .map(|o| serde_json::Value::Object(o.into_iter().collect()))
                .collect();
            Ok(json_orders)
        }
        Err(e) => Err(format!("Failed to get recent orders: {}", e))
    }
}

// Helper function to initialize execution engine with a specific broker
async fn init_execution_engine_with_broker(
    broker: Box<dyn BrokerAPI>,
    broker_config: OandaConfig, // Add config parameter
    state: &State<'_, AppState>,
    window: &tauri::Window,
) -> Result<String, String> {
    emit_log(window, "DEBUG", "Starting init_execution_engine_with_broker");
    
    // Check if already initialized
    {
        let engine_guard = state.execution_engine.lock().await;
        if engine_guard.is_some() {
            emit_log(window, "DEBUG", "ExecutionEngine already initialized");
            return Ok("ExecutionEngine already initialized".to_string());
        }
    }
    
    emit_log(window, "DEBUG", "Checking Redis connection...");
    
    // Check if Redis is available
    let redis_client = match RedisClient::open(state.redis_url.clone()) {
        Ok(client) => {
            emit_log(window, "DEBUG", "Redis client created");
            client
        }
        Err(e) => {
            emit_log(window, "ERROR", &format!("Failed to create Redis client: {}", e));
            return Err(format!("Failed to connect to Redis: {}", e));
        }
    };
    
    // Test Redis connection
    {
        emit_log(window, "DEBUG", "Testing Redis connection...");
        match redis_client.get_async_connection().await {
            Ok(_conn) => {
                emit_log(window, "DEBUG", "Redis connection test successful");
            }
            Err(e) => {
                emit_log(window, "ERROR", &format!("Redis connection test failed: {}", e));
                return Err(format!("Redis not available: {}", e));
            }
        }
    }
    
    emit_log(window, "DEBUG", "Creating ExecutionEngine with provided broker...");
    
    // Create ExecutionEngine with the provided broker
    let engine = ExecutionEngine::new(&state.redis_url, broker, state.orders_db.clone())
        .map_err(|e| {
            emit_log(window, "ERROR", &format!("Failed to create ExecutionEngine: {}", e));
            e
        })?;
    
    emit_log(window, "DEBUG", "Creating Redis client...");
    
    // Create Redis client
    let redis_client = RedisClient::open(state.redis_url.clone())
        .map_err(|e| {
            emit_log(window, "ERROR", &format!("Failed to create Redis client: {}", e));
            format!("Failed to create Redis client: {}", e)
        })?;
    
    emit_log(window, "DEBUG", "Storing Redis client...");
    
    // Store Redis client
    {
        let mut client_guard = state.redis_client.lock().await;
        *client_guard = Some(redis_client);
        emit_log(window, "DEBUG", "Redis client stored");
    }
    
    emit_log(window, "DEBUG", "Starting ExecutionEngine in background task...");
    
    // Don't store the engine in AppState - it runs independently in the background
    // Instead, mark that it's running
    {
        let mut engine_guard = state.execution_engine.lock().await;
        *engine_guard = Some(engine); // Store temporarily to mark as initialized
    }
    
    // Start the execution engine in a background task with its own broker
    let redis_url_clone = state.redis_url.clone();
    let orders_db_clone = state.orders_db.clone();
    let engine_window = window.clone();
    let broker_config_clone = broker_config.clone();
    
    tokio::spawn(async move {
        emit_log(&engine_window, "INFO", "ExecutionEngine background task started");
        
        // Create a new broker instance for the ExecutionEngine
        let mut engine_broker = OandaBroker::new(broker_config_clone);
        match engine_broker.connect().await {
            Ok(_) => {
                emit_log(&engine_window, "INFO", "ExecutionEngine broker connected");
                
                // Create a new ExecutionEngine with its own broker
                match ExecutionEngine::new(&redis_url_clone, Box::new(engine_broker), orders_db_clone) {
                    Ok(engine) => {
                        emit_log(&engine_window, "INFO", "Starting ExecutionEngine main loop...");
                        // This runs forever
                        if let Err(e) = engine.run().await {
                            emit_log(&engine_window, "ERROR", &format!("ExecutionEngine error: {}", e));
                        }
                    }
                    Err(e) => {
                        emit_log(&engine_window, "ERROR", &format!("Failed to create ExecutionEngine: {}", e));
                    }
                }
            }
            Err(e) => {
                emit_log(&engine_window, "ERROR", &format!("Failed to connect engine broker: {}", e));
            }
        }
        
        emit_log(&engine_window, "WARN", "ExecutionEngine background task ended");
    });
    
    emit_log(window, "DEBUG", "init_execution_engine_with_broker completed successfully");
    Ok("ExecutionEngine initialized".to_string())
}


// Initialize execution engine
#[tauri::command]
async fn init_execution_engine(
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    emit_log(&window, "INFO", "Initializing execution engine...");
    
    // Check if Redis is available
    let _redis_client = match RedisClient::open(state.redis_url.clone()) {
        Ok(client) => {
            emit_log(&window, "SUCCESS", "Connected to Redis");
            client
        }
        Err(e) => {
            emit_log(&window, "ERROR", &format!("Failed to connect to Redis: {}", e));
            return Err(format!("Failed to connect to Redis: {}. Make sure Redis is running on port 6379", e));
        }
    };
    
    // Check if we have a real broker connected
    {
        let broker_guard = state.broker.read().await;
        if broker_guard.is_none() {
            emit_log(&window, "ERROR", "No broker connected. Please select a broker profile first.");
            return Err("No broker connected. Please select a broker profile.".to_string());
        }
    }
    
    emit_log(&window, "ERROR", "ExecutionEngine requires dedicated broker instance");
    Err("Please use the broker profile dropdown to initialize ExecutionEngine".to_string())
}

// Cancel an order
#[tauri::command]
async fn cancel_order(
    order_id: String,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<serde_json::Value, String> {
    emit_log(&window, "INFO", &format!("Cancelling order: {}", order_id));
    
    // For now, we'll just mark it as cancelled in the database
    // In a real implementation, we'd also send cancel to the broker
    let broker_guard = state.broker.read().await;
    if let Some(broker) = broker_guard.as_ref() {
        match broker.cancel_order(&order_id).await {
            Ok(_response) => {
                emit_log(&window, "SUCCESS", &format!("Order {} cancelled", order_id));
                
                // TODO: Update order status in database
                
                // Emit order update event
                window.emit("order-update", serde_json::json!({
                    "order_id": order_id.clone(),
                    "status": "Cancelled",
                    "action": "cancelled"
                })).unwrap();
                
                Ok(serde_json::json!({
                    "success": true,
                    "order_id": order_id,
                    "status": "Cancelled"
                }))
            }
            Err(e) => {
                emit_log(&window, "ERROR", &format!("Failed to cancel order: {}", e));
                Err(format!("Failed to cancel order: {}", e))
            }
        }
    } else {
        emit_log(&window, "ERROR", "ExecutionEngine not initialized");
        Err("ExecutionEngine not initialized. Is Redis running?".to_string())
    }
}

#[tokio::main]
async fn main() {
    env_logger::init();
    
    // Database connection
    let database_url = "postgresql://postgres@localhost:5432/forex_trading";
    // Database connection logging will be done after we have window access
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
        .expect("Failed to connect to database");

    // Pre-warm the database connection and caches with a more realistic query
    // This loads actual data pages and indexes that will be used
    let three_months_ago = chrono::Utc::now().timestamp() - (90 * 24 * 60 * 60);
    match sqlx::query(
        "SELECT time, open, high, low, close, tick_count 
         FROM forex_candles_1h 
         WHERE symbol = 'EURUSD' 
           AND time >= to_timestamp($1)
         ORDER BY time
         LIMIT 100"
    )
        .bind(three_months_ago)
        .fetch_all(&pool)
        .await {
        Ok(_) => {
            // Connection is warm, caches are primed with actual data pages
        },
        Err(e) => {
            eprintln!("Warning: Failed to pre-warm database connection: {}", e);
            // Non-fatal - continue with cold connection
        }
    }
    
    // Pre-warm metadata queries for common symbols using optimized queries
    println!("[INFO] Pre-warming metadata cache...");
    let symbols = vec!["EURUSD", "USDJPY"];
    for symbol in symbols {
        // Pre-warm MIN query
        let _ = sqlx::query("SELECT time FROM forex_ticks WHERE symbol = $1 ORDER BY time ASC LIMIT 1")
            .bind(symbol)
            .fetch_optional(&pool)
            .await;
            
        // Pre-warm MAX query
        let _ = sqlx::query("SELECT time FROM forex_ticks WHERE symbol = $1 ORDER BY time DESC LIMIT 1")
            .bind(symbol)
            .fetch_optional(&pool)
            .await;
            
        // Pre-warm COUNT query
        match sqlx::query("SELECT COUNT(*) FROM forex_ticks WHERE symbol = $1")
            .bind(symbol)
            .fetch_optional(&pool)
            .await {
            Ok(_) => {
                println!("[INFO] Pre-warmed metadata for {}", symbol);
            },
            Err(e) => {
                eprintln!("Warning: Failed to pre-warm metadata for {}: {}", symbol, e);
            }
        }
    }

    // Initialize SQLite for orders
    let orders_db_path = env::current_dir()
        .unwrap()
        .join("orders.db");
    println!("Orders database path: {}", orders_db_path.display());
    let orders_db_url = format!("sqlite:{}?mode=rwc", orders_db_path.display());
    
    let orders_pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&orders_db_url)
        .await
        .expect("Failed to connect to orders database");
    
    // Initialize orders database schema
    database::orders::init_orders_db(&orders_pool)
        .await
        .expect("Failed to initialize orders database");
    
    let redis_url = "redis://127.0.0.1:6379";
    
    // Initialize market data engine
    let market_data_state = market_data::commands::init_market_data_engine(pool.clone());
    
    let app_state = AppState { 
        db_pool: Arc::new(Mutex::new(pool)),
        ingestion_processes: Arc::new(Mutex::new(HashMap::new())),
        candle_cache: Arc::new(RwLock::new(HashMap::new())),
        metadata_cache: Arc::new(RwLock::new(HashMap::new())),
        broker: Arc::new(RwLock::new(None)),
        redis_url: redis_url.to_string(),
        redis_client: Arc::new(Mutex::new(None)),
        execution_engine: Arc::new(Mutex::new(None)),
        orders_db: Arc::new(Mutex::new(orders_pool)),
        active_backtests: Arc::new(Mutex::new(HashMap::new())),
        // bitcoin_consumers: Arc::new(Mutex::new(HashMap::new())), // Removed - using direct DB ingestion
        candle_monitors: Arc::new(Mutex::new(HashMap::new())),
    };

    Builder::default()
        .manage(app_state)
        .manage(market_data_state)
        .invoke_handler(tauri::generate_handler![
            fetch_candles, 
            fetch_candles_v2, 
            check_database_connection,
            start_data_ingestion,
            cancel_ingestion,
            workspace::get_workspace_tree,
            workspace::read_component_file,
            workspace::save_component_file,
            workspace::create_component_file,
            workspace::run_component,
            workspace::get_indicator_categories,
            workspace::get_component_categories,
            workspace::get_workspace_components,
            workspace::delete_component_file,
            workspace::rename_component_file,
            workspace::delete_component_folder,
            workspace::rename_component_folder,
            workspace::load_parquet_data,
            workspace::list_test_datasets,
            workspace::write_temp_candles,
            get_ingestion_status,
            market_data::symbols::commands::get_available_data,
            market_data::symbols::commands::get_all_available_symbols,
            get_broker_connection_status,
            get_recent_orders,
            cancel_order,
            init_execution_engine,
            init_broker_from_profile,
            delete_data_range,
            refresh_candles,
            market_data::symbols::commands::get_symbol_metadata,
            export_test_data,
            test_orchestrator_load,
            run_orchestrator_backtest,
            cancel_backtest,
            run_orchestrator_live,
            // Bitcoin-specific commands (separate from forex)
            commands::bitcoin_data::get_bitcoin_chart_data,
            commands::bitcoin_data::get_bitcoin_realtime_data,
            commands::bitcoin_data::get_latest_bitcoin_tick,
            commands::bitcoin_data::get_bitcoin_24h_stats,
            // Candle monitor commands
            candle_monitor::start_candle_monitor,
            candle_monitor::stop_candle_monitor,
            candle_monitor::trigger_candle_update,
            // Market data commands
            search_assets,
            add_market_asset,
            get_pipeline_status,
            list_active_pipelines,
            stop_pipeline,
            save_pipeline_config,
            load_pipeline_config,
            mark_restore_completed,
            // Candles module commands
            candles::commands::get_market_candles
        ])
        .setup(|app| {
            // Get the main window handle
            let window = app.get_webview_window("main").expect("Failed to get main window");
            
            // Now we can log the database connection
            emit_log(&window, "INFO", &format!("Connecting to database: {}", "postgresql://postgres@localhost:5432/forex_trading"));
            emit_log(&window, "SUCCESS", "Database connected successfully");
            emit_log(&window, "INFO", "Connection pool established (10 connections)");
            
            // Check Redis availability on startup
            let window_clone = window.clone();
            let app_handle = app.handle().clone();
            tokio::spawn(async move {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    // Wait a moment for everything to be ready
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    
                    // Try to connect to Redis
                    match RedisClient::open(state.redis_url.clone()) {
                        Ok(_) => {
                            emit_log(&window_clone, "INFO", "Redis is available - order execution ready");
                        }
                        Err(_) => {
                            emit_log(&window_clone, "WARN", "Redis not available - order execution disabled");
                        }
                    }
                }
            });
            
            // Show window fullscreen
            window.show()?;
            window.set_fullscreen(true)?;
            
            Ok(())
        })
        .on_window_event(|window, event| {
            // Handle window close event
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
                
                // Save market data pipelines with clean shutdown flag
                let app_handle = window.app_handle();
                if let Some(market_data_state) = app_handle.try_state::<MarketDataState>() {
                    let engine = market_data_state.engine.clone();
                    tokio::spawn(async move {
                        if let Err(e) = save_final_state(engine).await {
                            eprintln!("[Shutdown] Failed to save pipeline state: {}", e);
                        } else {
                            println!("[Shutdown] Pipeline state saved successfully");
                        }
                    });
                }
                
                // Give async save a moment to complete
                std::thread::sleep(std::time::Duration::from_millis(500));
                std::process::exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("Error while running Tauri application");
}
