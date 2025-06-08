#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
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
        .invoke_handler(tauri::generate_handler![fetch_candles])
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