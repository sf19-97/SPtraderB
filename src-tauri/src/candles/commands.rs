use chrono::{DateTime, Utc};
use tauri::State;
use crate::AppState;
use super::{MarketCandle, MarketChartResponse, MarketMetadata, get_table_name, get_ticks_table};

#[tauri::command]
pub async fn get_market_candles(
    state: State<'_, AppState>,
    symbol: String,
    timeframe: String,
    from: i64,
    to: i64,
) -> Result<MarketChartResponse, String> {
    // Get the correct table based on symbol
    let table_name = get_table_name(&symbol, &timeframe)?;
    
    // Get the pool from AppState
    let pool = state.db_pool.lock().await;
    
    // Convert timestamps to DateTime
    let from_time = DateTime::<Utc>::from_timestamp(from, 0)
        .ok_or_else(|| "Invalid from timestamp".to_string())?;
    let to_time = DateTime::<Utc>::from_timestamp(to, 0)
        .ok_or_else(|| "Invalid to timestamp".to_string())?;

    // Query data with date range - following exact Bitcoin pattern
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


    let rows: Vec<(DateTime<Utc>, String, String, String, String, Option<i64>)> = 
        sqlx::query_as(&query)
            .bind(&symbol)
            .bind(&from_time)
            .bind(&to_time)
            .fetch_all(&*pool)
            .await
            .map_err(|e| format!("Database error: {}", e))?;
    

    if rows.is_empty() {
        return Ok(MarketChartResponse {
            data: vec![],
            metadata: Some(MarketMetadata {
                symbol: symbol.clone(),
                start_timestamp: 0,
                end_timestamp: 0,
                has_data: false,
            }),
        });
    }

    let candles: Vec<MarketCandle> = rows
        .into_iter()
        .map(|(time, open, high, low, close, volume)| {
            MarketCandle {
                time: time.to_rfc3339(),
                open,
                high,
                low,
                close,
                volume,
            }
        })
        .collect();

    // Get metadata from appropriate ticks table
    let ticks_table = get_ticks_table(&symbol)?;
    let metadata_query = format!(
        r#"
        SELECT 
            MIN(time) as start_time,
            MAX(time) as end_time,
            COUNT(*) as count
        FROM {}
        WHERE symbol = $1
        "#,
        ticks_table
    );

    let metadata_row: Option<(DateTime<Utc>, DateTime<Utc>, i64)> = 
        sqlx::query_as(&metadata_query)
            .bind(&symbol)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| format!("Metadata query error: {}", e))?;

    let metadata = if let Some((start_time, end_time, _count)) = metadata_row {
        Some(MarketMetadata {
            symbol: symbol.clone(),
            start_timestamp: start_time.timestamp(),
            end_timestamp: end_time.timestamp(),
            has_data: true,
        })
    } else {
        Some(MarketMetadata {
            symbol: symbol.clone(),
            start_timestamp: 0,
            end_timestamp: 0,
            has_data: false,
        })
    };

    Ok(MarketChartResponse {
        data: candles,
        metadata,
    })
}