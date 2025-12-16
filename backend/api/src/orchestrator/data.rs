use super::types::{Candle, CandleSeries};
use chrono::{DateTime, Utc};
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct CandleResponse {
    time: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: Option<i64>,
}

// TRUST BOUNDARY:
// This function performs mechanical validation and type conversion
// of external candle data (JSON -> internal Candle).
//
// It does NOT define execution semantics.
// Downstream code assumes the CandleSeries v1 execution contract
// described in orchestrator/DATA_CONTRACT.md.
/// Fetch historical candles from ws-market-data-server
pub async fn fetch_historical_candles(
    symbol: &str,
    timeframe: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<CandleSeries, String> {
    let base_url = std::env::var("WS_MARKET_DATA_URL")
        .unwrap_or_else(|_| "https://ws-market-data-server.fly.dev".to_string());

    let url = format!(
        "{}/api/candles?symbol={}&timeframe={}&from={}&to={}",
        base_url,
        symbol,
        timeframe,
        from.timestamp(),
        to.timestamp()
    );

    tracing::info!("Fetching candles from: {}", url);

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to fetch candles: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned error: {}", response.status()));
    }

    let candles_data: Vec<CandleResponse> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse candles: {}", e))?;

    // Convert to our Candle type
    let mut candles = Vec::with_capacity(candles_data.len());

    for candle_data in candles_data {
        let candle = Candle {
            time: DateTime::from_timestamp(candle_data.time, 0)
                .ok_or_else(|| format!("Invalid timestamp: {}", candle_data.time))?,
            open: Decimal::from_f64(candle_data.open)
                .ok_or_else(|| format!("Invalid open price: {}", candle_data.open))?,
            high: Decimal::from_f64(candle_data.high)
                .ok_or_else(|| format!("Invalid high price: {}", candle_data.high))?,
            low: Decimal::from_f64(candle_data.low)
                .ok_or_else(|| format!("Invalid low price: {}", candle_data.low))?,
            close: Decimal::from_f64(candle_data.close)
                .ok_or_else(|| format!("Invalid close price: {}", candle_data.close))?,
            volume: candle_data.volume.unwrap_or(0),
        };
        candles.push(candle);
    }

    tracing::info!("Fetched {} candles for {}", candles.len(), symbol);

    let mut candle_series = CandleSeries::new_v1(timeframe.to_string(), candles);
    candle_series.scan_ordering();
    candle_series.scan_cadence();

    Ok(candle_series)
}
