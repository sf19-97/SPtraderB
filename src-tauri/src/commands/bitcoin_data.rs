// Bitcoin-specific data commands - COMPLETELY SEPARATE from forex commands
// This ensures we don't interfere with existing forex functionality

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use chrono::{DateTime, Utc};

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
    pool: tauri::State<'_, PgPool>,
    symbol: String,
    timeframe: String,
) -> Result<BitcoinChartResponse, String> {
    // Validate symbol is Bitcoin
    if symbol != "BTCUSD" {
        return Err("Only BTCUSD is supported for Bitcoin data".to_string());
    }

    // Determine the correct Bitcoin table based on timeframe
    let table_name = match timeframe.as_str() {
        "5m" => "bitcoin_candles_5m",
        "15m" => "bitcoin_candles_15m",
        "1h" => "bitcoin_candles_1h",
        "4h" => "bitcoin_candles_4h",
        "12h" => "bitcoin_candles_12h",
        _ => return Err(format!("Unsupported timeframe: {}", timeframe)),
    };

    // Query Bitcoin data
    let query = format!(
        r#"
        SELECT 
            time AT TIME ZONE 'UTC' as time,
            open::text,
            high::text,
            low::text,
            close::text,
            tick_count as volume
        FROM {}
        WHERE symbol = $1
        ORDER BY time DESC
        LIMIT 5000
        "#,
        table_name
    );

    let rows: Vec<(DateTime<Utc>, String, String, String, String, Option<i64>)> = 
        sqlx::query_as(&query)
            .bind(&symbol)
            .fetch_all(&**pool)
            .await
            .map_err(|e| format!("Database error: {}", e))?;

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
        .map(|(time, open, high, low, close, volume)| BitcoinCandle {
            time: time.to_rfc3339(),
            open,
            high,
            low,
            close,
            volume,
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
            .fetch_optional(&**pool)
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
    _pool: tauri::State<'_, PgPool>,
    symbol: String,
) -> Result<serde_json::Value, String> {
    // Placeholder for real-time Bitcoin data from Pulsar
    // This will be implemented when we connect the Pulsar consumer
    
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