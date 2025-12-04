use super::types::BacktestResult;
use std::path::Path;

/// Store backtest result as JSON file
pub async fn store_backtest_result(
    backtest_id: &str,
    result: &BacktestResult,
) -> Result<(), String> {
    // Try local path first (for development), then /data/backtests (for production)
    let dir = Path::new("backtests");
    if !dir.exists() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create backtests directory: {}", e))?;
    }

    let file_path = format!("backtests/{}.json", backtest_id);
    let json = serde_json::to_string_pretty(result)
        .map_err(|e| format!("Failed to serialize result: {}", e))?;

    std::fs::write(&file_path, json).map_err(|e| format!("Failed to write result file: {}", e))?;

    tracing::info!("Stored backtest result: {}", file_path);
    Ok(())
}
