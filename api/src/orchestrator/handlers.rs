use axum::{
    extract::{Path, State, WebSocketUpgrade, ws::WebSocket},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use chrono::DateTime;
use rust_decimal::Decimal;
use rust_decimal::prelude::*;  // For ToPrimitive, FromPrimitive
use crate::AppState;
use super::{BacktestEngine, BacktestResult as EngineBacktestResult, store_backtest_result};

#[derive(Debug, Deserialize)]
pub struct RunBacktestRequest {
    pub strategy_name: String,
    pub start_date: String,  // ISO 8601 format
    pub end_date: String,    // ISO 8601 format
    pub symbol: String,
    pub timeframe: String,
    pub initial_capital: f64,
}

#[derive(Debug, Serialize)]
pub struct BacktestResponse {
    pub backtest_id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct BacktestStatus {
    pub backtest_id: String,
    pub status: String,
    pub progress: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct BacktestResults {
    pub backtest_id: String,
    pub start_capital: f64,
    pub end_capital: f64,
    pub total_trades: i32,
    pub winning_trades: i32,
    pub losing_trades: i32,
    pub total_pnl: f64,
    pub max_drawdown: f64,
    pub sharpe_ratio: f64,
    pub signals_generated: u32,
}

pub async fn run_backtest(
    State(state): State<AppState>,
    Json(payload): Json<RunBacktestRequest>,
) -> Result<Json<BacktestResponse>, (StatusCode, String)> {
    tracing::info!("Running backtest for strategy: {}", payload.strategy_name);

    // Generate backtest ID
    let backtest_id = uuid::Uuid::new_v4().to_string();

    // Parse dates
    let start_date = DateTime::parse_from_rfc3339(&payload.start_date)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid start_date: {}", e)))?
        .with_timezone(&chrono::Utc);

    let end_date = DateTime::parse_from_rfc3339(&payload.end_date)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid end_date: {}", e)))?
        .with_timezone(&chrono::Utc);

    let initial_capital = Decimal::from_f64(payload.initial_capital)
        .ok_or((StatusCode::BAD_REQUEST, "Invalid initial_capital".to_string()))?;

    // Load strategy YAML from workspace volume
    // Try workspace path (Docker volume), then local development path
    let workspace_path = format!("/app/workspace/strategies/{}.yaml", payload.strategy_name);
    let local_path = format!("workspace/strategies/{}.yaml", payload.strategy_name);
    let fallback_path = format!("{}.yaml", payload.strategy_name);

    let yaml_content = std::fs::read_to_string(&workspace_path)
        .or_else(|_| std::fs::read_to_string(&local_path))
        .or_else(|_| std::fs::read_to_string(&fallback_path))
        .map_err(|e| (StatusCode::NOT_FOUND, format!("Strategy not found: {}", e)))?;

    // Create backtest engine
    let engine = BacktestEngine::from_yaml(&yaml_content)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid strategy: {}", e)))?;

    // Spawn backtest in background
    let symbol = payload.symbol.clone();
    let timeframe = payload.timeframe.clone();
    let result_id = backtest_id.clone();

    tokio::spawn(async move {
        match engine.run_backtest(&symbol, &timeframe, start_date, end_date, initial_capital).await {
            Ok(result) => {
                // Store result
                if let Err(e) = store_backtest_result(&result_id, &result).await {
                    tracing::error!("Failed to store backtest result: {}", e);
                }
                tracing::info!("Backtest {} completed successfully", result_id);
            }
            Err(e) => {
                tracing::error!("Backtest {} failed: {}", result_id, e);
                // TODO: Store error status
            }
        }
    });

    Ok(Json(BacktestResponse {
        backtest_id,
        status: "running".to_string(),
    }))
}

pub async fn get_backtest_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<BacktestStatus>, StatusCode> {
    tracing::info!("Getting status for backtest: {}", id);

    // Check if result exists
    let result_path = format!("backtests/{}.json", id);
    if std::path::Path::new(&result_path).exists() {
        Ok(Json(BacktestStatus {
            backtest_id: id,
            status: "completed".to_string(),
            progress: Some(100.0),
        }))
    } else {
        Ok(Json(BacktestStatus {
            backtest_id: id,
            status: "running".to_string(),
            progress: Some(50.0), // TODO: Track actual progress
        }))
    }
}

pub async fn get_backtest_results(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<BacktestResults>, (StatusCode, String)> {
    tracing::info!("Getting results for backtest: {}", id);

    let result_path = format!("backtests/{}.json", id);
    let content = std::fs::read_to_string(&result_path)
        .map_err(|_| (StatusCode::NOT_FOUND, "Backtest not found or not completed".to_string()))?;

    let engine_result: EngineBacktestResult = serde_json::from_str(&content)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse result: {}", e)))?;

    // Convert to API response format
    let results = BacktestResults {
        backtest_id: id,
        start_capital: engine_result.start_capital.to_f64().unwrap_or(0.0),
        end_capital: engine_result.end_capital.to_f64().unwrap_or(0.0),
        total_trades: engine_result.total_trades,
        winning_trades: engine_result.winning_trades,
        losing_trades: engine_result.losing_trades,
        total_pnl: engine_result.total_pnl.to_f64().unwrap_or(0.0),
        max_drawdown: engine_result.max_drawdown.to_f64().unwrap_or(0.0),
        sharpe_ratio: engine_result.sharpe_ratio,
        signals_generated: engine_result.signals_generated,
    };

    Ok(Json(results))
}

pub async fn cancel_backtest(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    tracing::info!("Cancelling backtest: {}", id);
    // TODO: Implement cancellation mechanism
    Ok(StatusCode::NOT_IMPLEMENTED)
}

pub async fn backtest_websocket(
    ws: WebSocketUpgrade,
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_backtest_socket(socket, id, state))
}

async fn handle_backtest_socket(mut socket: WebSocket, backtest_id: String, state: AppState) {
    tracing::info!("WebSocket connected for backtest: {}", backtest_id);

    // TODO: Stream backtest progress updates
    // For now, send a test message
    if let Err(e) = socket.send(axum::extract::ws::Message::Text(
        serde_json::json!({
            "type": "progress",
            "backtest_id": backtest_id,
            "progress": 0.0
        }).to_string()
    )).await {
        tracing::error!("Failed to send WebSocket message: {}", e);
    }
}

#[derive(Debug, Serialize)]
pub struct StrategyInfo {
    pub name: String,
    pub description: Option<String>,
}

pub async fn list_strategies(
    State(state): State<AppState>,
) -> Result<Json<Vec<StrategyInfo>>, StatusCode> {
    // TODO: List strategies from filesystem
    tracing::info!("Listing strategies");

    Ok(Json(vec![
        StrategyInfo {
            name: "example_strategy".to_string(),
            description: Some("Example strategy".to_string()),
        }
    ]))
}

pub async fn get_strategy(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<String, StatusCode> {
    // TODO: Read strategy file
    tracing::info!("Getting strategy: {}", name);

    Err(StatusCode::NOT_IMPLEMENTED)
}

pub async fn save_strategy(
    State(state): State<AppState>,
    Path(name): Path<String>,
    body: String,
) -> Result<StatusCode, StatusCode> {
    // TODO: Save strategy file
    tracing::info!("Saving strategy: {}", name);

    Err(StatusCode::NOT_IMPLEMENTED)
}
