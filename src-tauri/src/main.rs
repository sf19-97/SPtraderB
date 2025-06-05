#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

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
        "5m" => "forex_candles_5m",
        "15m" => "forex_candles_15m",
        "1h" => "forex_candles_1h",
        "4h" => "forex_candles_4h",
        "12h" => "forex_candles_12h",
        _ => return Err("Invalid timeframe".to_string()),
    };

    let query = format!(
        "SELECT time, open, high, low, close, tick_count as volume FROM {} 
         WHERE symbol = $1 AND time >= to_timestamp($2) AND time <= to_timestamp($3)
         ORDER BY time",
        table_name
    );

    let pool = state.db_pool.lock().await;
    
    let candles = sqlx::query_as::<_, (chrono::DateTime<chrono::Utc>, f64, f64, f64, f64, i64)>(&query)
        .bind(&request.symbol)
        .bind(request.from)
        .bind(request.to)
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(candles
        .into_iter()
        .map(|(time, open, high, low, close, volume)| Candle {
            time: time.timestamp(),
            open,
            high,
            low,
            close,
            volume,
        })
        .collect())
}

#[tokio::main]
async fn main() {
    // Use the same connection string as your Python scripts
    let database_url = "postgresql://postgres@localhost:5432/forex_trading";
    
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
        .expect("Failed to connect to database");

    let app_state = AppState {
        db_pool: Arc::new(Mutex::new(pool)),
    };

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![fetch_candles])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}