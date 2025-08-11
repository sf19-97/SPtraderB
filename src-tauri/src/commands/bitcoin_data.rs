// Bitcoin-specific data commands - COMPLETELY SEPARATE from forex commands
// This ensures we don't interfere with existing forex functionality

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use tauri::State;
use crate::AppState;
use sqlx::Row;

#[derive(Debug, Serialize, Deserialize)]
pub struct BitcoinCandle {
    pub time: String,
    pub open: String,
    pub high: String,
    pub low: String,
    pub close: String,
    pub volume: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BitcoinChartResponse {
    pub data: Vec<BitcoinCandle>,
    pub metadata: Option<BitcoinMetadata>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BitcoinMetadata {
    pub symbol: String,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub has_data: bool,
}

#[tauri::command]
pub async fn get_bitcoin_chart_data(
    state: State<'_, AppState>,
    symbol: String,
    timeframe: String,
    from: i64,
    to: i64,
) -> Result<BitcoinChartResponse, String> {
    // Validate symbol is Bitcoin
    if symbol != "BTCUSD" {
        return Err("Only BTCUSD is supported for Bitcoin data".to_string());
    }

    // Determine the correct Bitcoin table based on timeframe
    let table_name = match timeframe.as_str() {
        "1m" => "bitcoin_candles_1m",
        "5m" => "bitcoin_candles_5m",
        "15m" => "bitcoin_candles_15m",
        "1h" => "bitcoin_candles_1h",
        "4h" => "bitcoin_candles_4h",
        "12h" => "bitcoin_candles_12h",
        _ => return Err(format!("Unsupported timeframe: {}", timeframe)),
    };

    // Get the pool from AppState
    let pool = state.db_pool.lock().await;
    
    // Convert timestamps to DateTime
    let from_time = DateTime::<Utc>::from_timestamp(from, 0)
        .ok_or_else(|| "Invalid from timestamp".to_string())?;
    let to_time = DateTime::<Utc>::from_timestamp(to, 0)
        .ok_or_else(|| "Invalid to timestamp".to_string())?;

    // Query Bitcoin data with date range
    let query = format!(
        r#"
        SELECT 
            time,
            open::text,
            high::text,
            low::text,
            close::text,
            tick_count::INT8 as volume
        FROM {}
        WHERE symbol = $1
            AND time >= $2
            AND time <= $3
        ORDER BY time ASC
        "#,
        table_name
    );

    println!("[Bitcoin] Fetching {} candles from {} to {}", 
        timeframe, 
        from_time.format("%Y-%m-%d %H:%M:%S UTC"), 
        to_time.format("%Y-%m-%d %H:%M:%S UTC")
    );

    let rows: Vec<(DateTime<Utc>, String, String, String, String, Option<i64>)> = 
        sqlx::query_as(&query)
            .bind(&symbol)
            .bind(&from_time)
            .bind(&to_time)
            .fetch_all(&*pool)
            .await
            .map_err(|e| format!("Database error: {}", e))?;
    
    println!("[Bitcoin] Fetched {} candles", rows.len());
    
    if !rows.is_empty() {
        let first_time = &rows[0].0;
        let last_time = &rows[rows.len() - 1].0;
        println!("[Bitcoin] First candle: {} (UTC)", first_time.to_rfc3339());
        println!("[Bitcoin] Last candle: {} (UTC)", last_time.to_rfc3339());
    }

    if rows.is_empty() {
        return Ok(BitcoinChartResponse {
            data: vec![],
            metadata: Some(BitcoinMetadata {
                symbol: symbol.clone(),
                start_timestamp: 0,
                end_timestamp: 0,
                has_data: false,
            }),
        });
    }

    let candles: Vec<BitcoinCandle> = rows
        .into_iter()
        .map(|(time, open, high, low, close, volume)| {
            println!("[Bitcoin] Candle time: {} (UTC timestamp: {})", 
                time.to_rfc3339(), 
                time.timestamp()
            );
            BitcoinCandle {
                time: time.to_rfc3339(),
                open,
                high,
                low,
                close,
                volume,
            }
        })
        .collect();

    // Get metadata
    let metadata_query = r#"
        SELECT 
            MIN(time) as start_time,
            MAX(time) as end_time,
            COUNT(*) as count
        FROM bitcoin_ticks
        WHERE symbol = $1
    "#;

    let metadata_row: Option<(DateTime<Utc>, DateTime<Utc>, i64)> = 
        sqlx::query_as(metadata_query)
            .bind(&symbol)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| format!("Metadata query error: {}", e))?;

    let metadata = if let Some((start_time, end_time, _count)) = metadata_row {
        Some(BitcoinMetadata {
            symbol: symbol.clone(),
            start_timestamp: start_time.timestamp(),
            end_timestamp: end_time.timestamp(),
            has_data: true,
        })
    } else {
        Some(BitcoinMetadata {
            symbol: symbol.clone(),
            start_timestamp: 0,
            end_timestamp: 0,
            has_data: false,
        })
    };

    Ok(BitcoinChartResponse {
        data: candles,
        metadata,
    })
}

#[tauri::command]
pub async fn get_bitcoin_realtime_data(
    _state: State<'_, AppState>,
    symbol: String,
) -> Result<serde_json::Value, String> {
    // Real-time data comes from direct database queries
    // See get_latest_bitcoin_tick() for current implementation
    
    if symbol != "BTCUSD" {
        return Err("Only BTCUSD is supported".to_string());
    }

    // For now, return empty response
    Ok(serde_json::json!({
        "symbol": symbol,
        "realtime": false,
        "message": "Real-time data integration pending"
    }))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BitcoinTick {
    pub bid: f64,
    pub ask: f64,
    pub time: String,
}

#[tauri::command]
pub async fn get_latest_bitcoin_tick(
    state: State<'_, AppState>,
) -> Result<BitcoinTick, String> {
    let pool = state.db_pool.lock().await;
    
    let query = r#"
        SELECT bid, ask, time
        FROM bitcoin_ticks
        WHERE symbol = 'BTCUSD'
        ORDER BY time DESC
        LIMIT 1
    "#;
    
    let row = sqlx::query(query)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| format!("Failed to fetch latest tick: {}", e))?;
        
    if let Some(row) = row {
        let bid: f64 = row.get("bid");
        let ask: f64 = row.get("ask");
        let time: DateTime<Utc> = row.get("time");
        
        Ok(BitcoinTick {
            bid,
            ask,
            time: time.to_rfc3339(),
        })
    } else {
        Err("No Bitcoin tick data available".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Bitcoin24hStats {
    pub high: f64,
    pub low: f64,
    pub change: f64,
    pub change_percent: f64,
    pub volume: f64,
}

#[tauri::command]
pub async fn get_bitcoin_24h_stats(
    state: State<'_, AppState>,
) -> Result<Bitcoin24hStats, String> {
    let pool = state.db_pool.lock().await;
    
    let query = r#"
        WITH latest_price AS (
            SELECT bid, ask
            FROM bitcoin_ticks
            WHERE symbol = 'BTCUSD'
            ORDER BY time DESC
            LIMIT 1
        ),
        price_24h_ago AS (
            SELECT (bid + ask) / 2 as price
            FROM bitcoin_ticks
            WHERE symbol = 'BTCUSD'
            AND time <= NOW() - INTERVAL '24 hours'
            ORDER BY time DESC
            LIMIT 1
        ),
        stats_24h AS (
            SELECT 
                MAX(bid) as high,
                MIN(bid) as low,
                COUNT(*) as tick_count
            FROM bitcoin_ticks
            WHERE symbol = 'BTCUSD'
            AND time >= NOW() - INTERVAL '24 hours'
        )
        SELECT 
            stats_24h.high,
            stats_24h.low,
            stats_24h.tick_count,
            (latest_price.bid + latest_price.ask) / 2 as current_price,
            price_24h_ago.price as price_24h_ago
        FROM stats_24h, latest_price, price_24h_ago
    "#;
    
    let row = sqlx::query(query)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| format!("Failed to fetch 24h stats: {}", e))?;
        
    if let Some(row) = row {
        let high: f64 = row.get("high");
        let low: f64 = row.get("low");
        let tick_count: i64 = row.get("tick_count");
        let current_price: f64 = row.get("current_price");
        let price_24h_ago: f64 = row.get("price_24h_ago");
        
        let change = current_price - price_24h_ago;
        let change_percent = if price_24h_ago != 0.0 {
            (current_price - price_24h_ago) / price_24h_ago * 100.0
        } else {
            0.0
        };
        
        Ok(Bitcoin24hStats {
            high,
            low,
            change,
            change_percent,
            volume: tick_count as f64, // Using tick count as proxy for volume
        })
    } else {
        Err("No Bitcoin data available for 24h stats".to_string())
    }
}