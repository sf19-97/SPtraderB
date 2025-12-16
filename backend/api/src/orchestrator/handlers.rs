use super::{
    store_backtest_result, BacktestEngine, BacktestResult as EngineBacktestResult, BacktestState,
    CandleSeriesRequirement, ExecutionMode,
};
use crate::AppState;
use axum::{
    extract::{ws::WebSocket, Path, State, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::DateTime;
use rust_decimal::prelude::*; // For ToPrimitive, FromPrimitive
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::sync::{atomic::Ordering, Arc};
use tokio::time::{self, Duration};

#[derive(Debug, Deserialize)]
pub struct RunBacktestRequest {
    pub strategy_name: String,
    pub start_date: String, // ISO 8601 format
    pub end_date: String,   // ISO 8601 format
    pub symbol: String,
    pub timeframe: String,
    pub initial_capital: f64,
    pub execution_mode: Option<ExecutionMode>,
    pub candle_requirement: Option<CandleSeriesRequirement>,
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
    pub completed_trades: Vec<TradeResponse>,
    pub daily_returns: Vec<(String, f64)>,
}

#[derive(Debug, Serialize)]
pub struct TradeResponse {
    pub id: String,
    pub symbol: String,
    pub side: String,
    pub entry_time: String,
    pub entry_price: f64,
    pub exit_time: String,
    pub exit_price: f64,
    pub quantity: f64,
    pub pnl: f64,
    pub pnl_percent: f64,
    pub exit_reason: String,
    pub holding_period_hours: f64,
}

pub async fn run_backtest(
    State(state): State<AppState>,
    Json(payload): Json<RunBacktestRequest>,
) -> Result<Json<BacktestResponse>, (StatusCode, String)> {
    tracing::info!("Running backtest for strategy: {}", payload.strategy_name);

    // Generate backtest ID
    let backtest_id = uuid::Uuid::new_v4().to_string();
    let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));

    {
        let mut registry = state.backtests.write().await;
        registry.insert(
            backtest_id.clone(),
            BacktestState {
                status: "running".to_string(),
                progress: 0.0,
                error: None,
                cancel_flag: cancel_flag.clone(),
            },
        );
    }

    // Parse dates
    let start_date = DateTime::parse_from_rfc3339(&payload.start_date)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Invalid start_date: {}", e),
            )
        })?
        .with_timezone(&chrono::Utc);

    let end_date = DateTime::parse_from_rfc3339(&payload.end_date)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid end_date: {}", e)))?
        .with_timezone(&chrono::Utc);

    let initial_capital = Decimal::from_f64(payload.initial_capital).ok_or((
        StatusCode::BAD_REQUEST,
        "Invalid initial_capital".to_string(),
    ))?;

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
    let execution_mode = payload
        .execution_mode
        .unwrap_or(ExecutionMode::Research);
    let candle_requirement = payload
        .candle_requirement
        .unwrap_or(CandleSeriesRequirement::V1Trusted);

    tokio::spawn(async move {
        let registry = state.backtests.clone();

        match engine
            .run_backtest(
                &result_id,
                &symbol,
                &timeframe,
                start_date,
                end_date,
                initial_capital,
                execution_mode,
                candle_requirement,
                Some(cancel_flag.clone()),
                Some(registry.clone()),
            )
            .await
        {
            Ok(result) => {
                // Store result
                if let Err(e) = store_backtest_result(&result_id, &result).await {
                    tracing::error!("Failed to store backtest result: {}", e);
                }

                let mut state = registry.write().await;
                if let Some(entry) = state.get_mut(&result_id) {
                    entry.status = "completed".to_string();
                    entry.progress = 100.0;
                }
                tracing::info!("Backtest {} completed successfully", result_id);
            }
            Err(e) => {
                tracing::error!("Backtest {} failed: {}", result_id, e);
                let mut state = registry.write().await;
                if let Some(entry) = state.get_mut(&result_id) {
                    entry.status = "failed".to_string();
                    entry.error = Some(e);
                }
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

    if let Some(entry) = state.backtests.read().await.get(&id).cloned() {
        return Ok(Json(BacktestStatus {
            backtest_id: id,
            status: entry.status,
            progress: Some(entry.progress),
        }));
    }

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
    let content = std::fs::read_to_string(&result_path).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            "Backtest not found or not completed".to_string(),
        )
    })?;

    let engine_result: EngineBacktestResult = serde_json::from_str(&content).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to parse result: {}", e),
        )
    })?;

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
        completed_trades: engine_result
            .completed_trades
            .iter()
            .map(|t| TradeResponse {
                id: t.id.clone(),
                symbol: t.symbol.clone(),
                side: match t.side {
                    super::types::PositionSide::Long => "long".to_string(),
                    super::types::PositionSide::Short => "short".to_string(),
                },
                entry_time: t.entry_time.to_rfc3339(),
                entry_price: t.entry_price.to_f64().unwrap_or(0.0),
                exit_time: t.exit_time.to_rfc3339(),
                exit_price: t.exit_price.to_f64().unwrap_or(0.0),
                quantity: t.quantity.to_f64().unwrap_or(0.0),
                pnl: t.pnl.to_f64().unwrap_or(0.0),
                pnl_percent: t.pnl_percent.to_f64().unwrap_or(0.0),
                exit_reason: t.exit_reason.clone(),
                holding_period_hours: t.holding_period_hours,
            })
            .collect(),
        daily_returns: engine_result
            .daily_returns
            .iter()
            .map(|(ts, v)| (ts.to_rfc3339(), v.to_f64().unwrap_or(0.0)))
            .collect(),
    };

    Ok(Json(results))
}

pub async fn cancel_backtest(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    tracing::info!("Cancelling backtest: {}", id);

    let mut registry = state.backtests.write().await;
    if let Some(entry) = registry.get_mut(&id) {
        entry.status = "cancelling".to_string();
        entry.cancel_flag.store(true, Ordering::Relaxed);
        return Ok(StatusCode::OK);
    }

    Err(StatusCode::NOT_FOUND)
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

    let mut interval = time::interval(Duration::from_millis(500));

    loop {
        interval.tick().await;

        let status_snapshot = state.backtests.read().await.get(&backtest_id).cloned();

        if let Some(entry) = status_snapshot {
            let payload = serde_json::json!({
                "type": "progress",
                "backtest_id": backtest_id,
                "status": entry.status,
                "progress": entry.progress,
                "error": entry.error,
            })
            .to_string();

            if let Err(e) = socket.send(axum::extract::ws::Message::Text(payload)).await {
                tracing::error!("Failed to send WebSocket message: {}", e);
                break;
            }

            if matches!(entry.status.as_str(), "completed" | "failed" | "cancelled") {
                break;
            }
        } else {
            // If we lost track of the backtest, stop the loop
            break;
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StrategyInfo {
    pub name: String,
    pub description: Option<String>,
}

pub async fn list_strategies(
    State(_state): State<AppState>,
) -> Result<Json<Vec<StrategyInfo>>, StatusCode> {
    // TODO: List strategies from filesystem
    tracing::info!("Listing strategies");

    Ok(Json(vec![StrategyInfo {
        name: "example_strategy".to_string(),
        description: Some("Example strategy".to_string()),
    }]))
}

pub async fn get_strategy(
    State(_state): State<AppState>,
    Path(name): Path<String>,
) -> Result<String, StatusCode> {
    // TODO: Read strategy file
    tracing::info!("Getting strategy: {}", name);

    Err(StatusCode::NOT_IMPLEMENTED)
}

pub async fn save_strategy(
    State(_state): State<AppState>,
    Path(name): Path<String>,
    _body: String,
) -> Result<StatusCode, StatusCode> {
    // TODO: Save strategy file
    tracing::info!("Saving strategy: {}", name);

    Err(StatusCode::NOT_IMPLEMENTED)
}
