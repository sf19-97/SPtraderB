#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{State, Builder, Manager, WindowEvent};

#[derive(Debug, Serialize, Deserialize)]
struct Candle {
    time: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: i64,
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
}

#[tauri::command]
async fn fetch_candles(
    request: DataRequest,
    state: State<'_, AppState>,
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

    println!("[FETCH_CANDLES] Query: {}", query);
    println!("[FETCH_CANDLES] Params: symbol={}, from={}, to={}",
             request.symbol, request.from, request.to);

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
) -> Result<Vec<Candle>, String> {
    let start_time = std::time::Instant::now();
    
    println!("[V2] Fetch request: symbol={}, from={}, to={}, detail={}", 
             request.symbol, request.from, request.to, request.detail_level);

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

    println!("[V2] Query: {}", query);

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
    println!("[V2 PERF] Fetched {} candles in {}ms", candles.len(), duration.as_millis());

    Ok(candles)
}

#[tokio::main]
async fn main() {
    env_logger::init();
    
    // Database connection
    let database_url = "postgresql://postgres@localhost:5432/forex_trading";
    println!("[MAIN] Connecting to database: {}", database_url);
    
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
        .expect("Failed to connect to database");
    
    println!("[MAIN] Database connected successfully");

    let app_state = AppState { 
        db_pool: Arc::new(Mutex::new(pool)) 
    };

    Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![fetch_candles, fetch_candles_v2, check_database_connection])
        .setup(|app| {
            // Get the main window handle
            let window = app.get_webview_window("main").expect("Failed to get main window");
            
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