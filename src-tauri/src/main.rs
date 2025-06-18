#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{State, Builder, Manager, WindowEvent, Emitter};
use tokio::process::{Command, Child};
use std::process::Stdio;
use std::collections::HashMap;
use serde_json;
use chrono::Datelike;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Clone, Debug, Serialize)]
struct LogEvent {
    timestamp: String,
    level: String,
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Candle {
    time: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: i64,
}

#[derive(Debug, Serialize)]
struct SymbolMetadata {
    symbol: String,
    start_timestamp: i64,
    end_timestamp: i64,
    has_data: bool,
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
            tick_count::INT8 as volume
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

    Ok(rows.into_iter().map(|(time, open, high, low, close, volume)| Candle {
        time: time.timestamp(),
        open,
        high,
        low,
        close,
        volume,
    }).collect())
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

#[derive(Debug, Serialize)]
struct AvailableDataItem {
    symbol: String,
    start_date: String,
    end_date: String,
    tick_count: i64,
    candle_count_5m: i64,
    candle_count_15m: i64,
    candle_count_1h: i64,
    candle_count_4h: i64,
    candle_count_12h: i64,
    last_updated: String,
    size_mb: f64,
    candles_up_to_date: bool,
    last_candle_refresh: Option<String>,
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
                let symbol_stderr = symbol.clone();
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
async fn get_available_data(
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<Vec<AvailableDataItem>, String> {
    emit_log(&window, "INFO", "Fetching available data summary");
    
    let pool = state.db_pool.lock().await;
    
    // Query to get summary of available data
    let query = r#"
        WITH tick_summary AS (
            SELECT 
                symbol,
                MIN(time)::date as start_date,
                MAX(time)::date as end_date,
                COUNT(*) as tick_count,
                MAX(time) as last_updated
            FROM forex_ticks
            GROUP BY symbol
        ),
        candle_summary AS (
            SELECT 
                t.symbol,
                t.start_date,
                t.end_date,
                t.tick_count,
                t.last_updated,
                COALESCE(c5m.count, 0) as candle_count_5m,
                COALESCE(c15.count, 0) as candle_count_15m,
                COALESCE(c1h.count, 0) as candle_count_1h,
                COALESCE(c4h.count, 0) as candle_count_4h,
                COALESCE(c12h.count, 0) as candle_count_12h,
                m.last_refresh_timestamp,
                m.last_tick_timestamp
            FROM tick_summary t
            LEFT JOIN (
                SELECT symbol, COUNT(*) as count 
                FROM forex_candles_5m 
                GROUP BY symbol
            ) c5m ON t.symbol = c5m.symbol
            LEFT JOIN (
                SELECT symbol, COUNT(*) as count 
                FROM forex_candles_15m 
                GROUP BY symbol
            ) c15 ON t.symbol = c15.symbol
            LEFT JOIN (
                SELECT symbol, COUNT(*) as count 
                FROM forex_candles_1h 
                GROUP BY symbol
            ) c1h ON t.symbol = c1h.symbol
            LEFT JOIN (
                SELECT symbol, COUNT(*) as count 
                FROM forex_candles_4h 
                GROUP BY symbol
            ) c4h ON t.symbol = c4h.symbol
            LEFT JOIN (
                SELECT symbol, COUNT(*) as count 
                FROM forex_candles_12h 
                GROUP BY symbol
            ) c12h ON t.symbol = c12h.symbol
            LEFT JOIN candle_refresh_metadata m ON t.symbol = m.symbol
        )
        SELECT * FROM candle_summary ORDER BY symbol
    "#;
    
    let rows = sqlx::query(query)
        .fetch_all(&*pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    
    let mut result = Vec::new();
    
    for row in rows {
        let symbol: String = row.try_get("symbol").map_err(|e| format!("Failed to get symbol: {}", e))?;
        let start_date: chrono::NaiveDate = row.try_get("start_date").map_err(|e| format!("Failed to get start_date: {}", e))?;
        let end_date: chrono::NaiveDate = row.try_get("end_date").map_err(|e| format!("Failed to get end_date: {}", e))?;
        let tick_count: i64 = row.try_get("tick_count").map_err(|e| format!("Failed to get tick_count: {}", e))?;
        let last_updated: chrono::DateTime<chrono::Utc> = row.try_get("last_updated").map_err(|e| format!("Failed to get last_updated: {}", e))?;
        let candle_count_5m: i64 = row.try_get("candle_count_5m").map_err(|e| format!("Failed to get candle_count_5m: {}", e))?;
        let candle_count_15m: i64 = row.try_get("candle_count_15m").map_err(|e| format!("Failed to get candle_count_15m: {}", e))?;
        let candle_count_1h: i64 = row.try_get("candle_count_1h").map_err(|e| format!("Failed to get candle_count_1h: {}", e))?;
        let candle_count_4h: i64 = row.try_get("candle_count_4h").map_err(|e| format!("Failed to get candle_count_4h: {}", e))?;
        let candle_count_12h: i64 = row.try_get("candle_count_12h").map_err(|e| format!("Failed to get candle_count_12h: {}", e))?;
        
        // Get refresh metadata
        let last_refresh_timestamp: Option<chrono::DateTime<chrono::Utc>> = row.try_get("last_refresh_timestamp").ok();
        let last_tick_timestamp: Option<chrono::DateTime<chrono::Utc>> = row.try_get("last_tick_timestamp").ok();
        
        // Check if candles are up to date
        let candles_up_to_date = if let (Some(refresh_ts), Some(tick_ts)) = (last_refresh_timestamp, last_tick_timestamp) {
            // Consider up-to-date if last refresh is within 1 hour of the last tick
            (last_updated - refresh_ts).num_hours() <= 1 && (tick_ts >= last_updated - chrono::Duration::hours(1))
        } else {
            false // Never been refreshed
        };
        
        // Estimate size in MB (rough approximation: 40 bytes per tick)
        let size_mb = (tick_count as f64 * 40.0) / (1024.0 * 1024.0);
        
        result.push(AvailableDataItem {
            symbol,
            start_date: start_date.to_string(),
            end_date: end_date.to_string(),
            tick_count,
            candle_count_5m,
            candle_count_15m,
            candle_count_1h,
            candle_count_4h,
            candle_count_12h,
            last_updated: last_updated.to_rfc3339(),
            size_mb,
            candles_up_to_date,
            last_candle_refresh: last_refresh_timestamp.map(|ts| ts.to_rfc3339()),
        });
    }
    
    emit_log(&window, "INFO", &format!("Found {} symbols with data", result.len()));
    Ok(result)
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
    start_date: String,
    end_date: String,
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
    
    let mut refresh_end = newest_tick + chrono::Duration::hours(1); // Add buffer
    
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
    
    emit_log(&window, "SUCCESS", "All candles refreshed successfully");
    Ok(true)
}

#[tauri::command]
async fn get_symbol_metadata(
    symbol: String,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<SymbolMetadata, String> {
    emit_log(&window, "INFO", &format!("Fetching metadata for {}", symbol));
    
    let pool = state.db_pool.lock().await;
    
    // Query to get the date range for the symbol
    let query = r#"
        SELECT 
            MIN(time) as start_time,
            MAX(time) as end_time,
            COUNT(*) as tick_count
        FROM forex_ticks
        WHERE symbol = $1
    "#;
    
    let result = sqlx::query(query)
        .bind(&symbol)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    
    if let Some(row) = result {
        let start_time: Option<chrono::DateTime<chrono::Utc>> = row.try_get("start_time").ok();
        let end_time: Option<chrono::DateTime<chrono::Utc>> = row.try_get("end_time").ok();
        let tick_count: Option<i64> = row.try_get("tick_count").ok();
        
        if let (Some(start), Some(end), Some(count)) = (start_time, end_time, tick_count) {
            if count > 0 {
                emit_log(&window, "INFO", &format!("Found data for {}: {} to {}", 
                         symbol, start.format("%Y-%m-%d"), end.format("%Y-%m-%d")));
                
                return Ok(SymbolMetadata {
                    symbol: symbol.clone(),
                    start_timestamp: start.timestamp(),
                    end_timestamp: end.timestamp(),
                    has_data: true,
                });
            }
        }
    }
    
    // No data found for symbol
    emit_log(&window, "INFO", &format!("No data found for {}", symbol));
    Ok(SymbolMetadata {
        symbol: symbol.clone(),
        start_timestamp: 0,
        end_timestamp: 0,
        has_data: false,
    })
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

    let app_state = AppState { 
        db_pool: Arc::new(Mutex::new(pool)),
        ingestion_processes: Arc::new(Mutex::new(HashMap::new())),
    };

    Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            fetch_candles, 
            fetch_candles_v2, 
            check_database_connection,
            start_data_ingestion,
            cancel_ingestion,
            get_ingestion_status,
            get_available_data,
            delete_data_range,
            refresh_candles,
            get_symbol_metadata
        ])
        .setup(|app| {
            // Get the main window handle
            let window = app.get_webview_window("main").expect("Failed to get main window");
            
            // Now we can log the database connection
            emit_log(&window, "INFO", &format!("Connecting to database: {}", "postgresql://postgres@localhost:5432/forex_trading"));
            emit_log(&window, "SUCCESS", "Database connected successfully");
            emit_log(&window, "INFO", "Connection pool established (10 connections)");
            
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
                std::process::exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("Error while running Tauri application");
}