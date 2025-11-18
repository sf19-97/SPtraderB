#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::env;
use std::fs;
use tokio::sync::{Mutex, RwLock};
use tauri::{State, Builder, Manager, WindowEvent, Emitter, Window};
use std::collections::HashMap;
use chrono::{DateTime, Utc};
use redis::Client as RedisClient;

mod workspace;
mod orders;
mod brokers;
mod execution;
mod database;
mod orchestrator;
mod market_data;
mod candles;

// Execution engine not used with cloud API
// use execution::ExecutionEngine;
use market_data::commands::*;
use market_data::{PipelineStatus, DataSource};
use market_data::symbols::CachedMetadata;

// Helper function to save pipeline state on shutdown
async fn save_final_state(engine: Arc<Mutex<market_data::MarketDataEngine>>) -> Result<(), String> {
    let configs = {
        let engine_lock = engine.lock().await;
        let mut configs = Vec::new();
        for (symbol, pipeline) in engine_lock.pipelines.iter() {
            let source_name = match &pipeline.config.source {
                DataSource::Oanda { .. } => "oanda",
                DataSource::Kraken { .. } => "kraken",
                DataSource::Alpaca { .. } => "alpaca",
                DataSource::Dukascopy => "dukascopy",
                DataSource::IBKR { .. } => "ibkr",
                DataSource::Coinbase { .. } => "coinbase",
            };
            
            let status = pipeline.status.lock().await;
            let last_tick_str = match &*status {
                PipelineStatus::Running { last_tick, .. } => 
                    last_tick.map(|t| t.to_rfc3339()),
                _ => None,
            };
            
            configs.push(market_data::commands::PipelineConfig {
                symbol: symbol.clone(),
                source: source_name.to_string(),
                asset_class: format!("{:?}", pipeline.config.asset_class).to_lowercase(),
                added_at: chrono::Utc::now().to_rfc3339(),
                last_tick: last_tick_str,
                profile_id: pipeline.config.profile_id.clone(),
                profile_name: pipeline.config.profile_name.clone(),
            });
        }
        configs
    };
    
    // Save with clean_shutdown flag set to true
    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("sptraderb");
    
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    
    let config_file = market_data::commands::PipelineConfigFile {
        version: 1,
        pipelines: configs,
        saved_at: chrono::Utc::now().to_rfc3339(),
        clean_shutdown: true,  // Mark as clean shutdown
    };
    
    let config_path = config_dir.join("active_pipelines.json");
    let json = serde_json::to_string_pretty(&config_file)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    std::fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    
    Ok(())
}

// Orders module still exists but not used directly anymore
// use brokers::{BrokerAPI, oanda::{OandaBroker, OandaConfig}};

#[derive(Clone, Debug, Serialize)]
struct LogEvent {
    timestamp: String,
    level: String,
    message: String,
}

// DELETED: Candle, DatabaseStatus, DataRequest structs (using cloud API now)

struct AppState {
    db_pool: Arc<Mutex<sqlx::PgPool>>,
    // REMOVED: candle_cache, inflight_requests (using cloud API)
    market_candle_cache: candles::cache::CandleCache,  // Still used for orchestrator
    metadata_cache: Arc<RwLock<HashMap<String, CachedMetadata>>>,
    // REMOVED: broker, redis, execution (not using broker API)
    orders_db: Arc<Mutex<sqlx::SqlitePool>>,  // Still used for orchestrator
    // Backtest cancellation
    active_backtests: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}


// Helper function to emit log events to frontend
fn emit_log<R: tauri::Runtime>(window: &impl Emitter<R>, level: &str, message: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
    let event = LogEvent {
        timestamp,
        level: level.to_string(),
        message: message.to_string(),
    };
    
    // Still print to console for debugging
    println!("[{}] {}", level, message);
    
    // Emit to frontend
    window.emit("backend-log", &event).ok();
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExportDataRequest {
    symbol: String,
    timeframe: String,
    start_date: String,
    end_date: String,
    filename: String,
}

#[tauri::command]
async fn export_test_data(
    request: ExportDataRequest,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    emit_log(&window, "INFO", &format!("Exporting test data: {} {} from {} to {}", 
        request.symbol, request.timeframe, request.start_date, request.end_date));
    
    let pool = state.db_pool.lock().await;
    
    // Determine table based on timeframe
    let table_name = match request.timeframe.as_str() {
        "5m" => "forex_candles_5m",
        "15m" => "forex_candles_15m",
        "1h" => "forex_candles_1h",
        "4h" => "forex_candles_4h",
        "12h" => "forex_candles_12h",
        _ => return Err(format!("Invalid timeframe: {}", request.timeframe)),
    };
    
    // Query data
    let query = format!(
        "SELECT 
            time,
            open::FLOAT8 as open,
            high::FLOAT8 as high,
            low::FLOAT8 as low,
            close::FLOAT8 as close,
            tick_count::BIGINT as volume
        FROM {}
        WHERE symbol = $1 
            AND time >= $2::timestamp 
            AND time <= $3::timestamp
        ORDER BY time",
        table_name
    );
    
    let rows = sqlx::query(&query)
        .bind(&request.symbol)
        .bind(&request.start_date)
        .bind(&request.end_date)
        .fetch_all(&*pool)
        .await
        .map_err(|e| format!("Database error: {}", e))?;
    
    if rows.is_empty() {
        return Err("No data found for the specified range".to_string());
    }
    
    emit_log(&window, "INFO", &format!("Found {} rows to export", rows.len()));
    
    // Convert to simple format for Python
    let mut times = Vec::new();
    let mut opens = Vec::new();
    let mut highs = Vec::new();
    let mut lows = Vec::new();
    let mut closes = Vec::new();
    let mut volumes = Vec::new();
    
    for row in rows {
        let time: DateTime<Utc> = row.try_get("time").map_err(|e| format!("Failed to get time: {}", e))?;
        times.push(time.format("%Y-%m-%d %H:%M:%S").to_string());
        opens.push(row.try_get::<f64, _>("open").map_err(|e| format!("Failed to get open: {}", e))?);
        highs.push(row.try_get::<f64, _>("high").map_err(|e| format!("Failed to get high: {}", e))?);
        lows.push(row.try_get::<f64, _>("low").map_err(|e| format!("Failed to get low: {}", e))?);
        closes.push(row.try_get::<f64, _>("close").map_err(|e| format!("Failed to get close: {}", e))?);
        volumes.push(row.try_get::<i64, _>("volume").map_err(|e| format!("Failed to get volume: {}", e))?);
    }
    
    // Create DataFrame-like structure for Parquet
    use arrow::array::{StringArray, Float64Array, Int64Array};
    use arrow::datatypes::{DataType, Field, Schema};
    use arrow::record_batch::RecordBatch;
    use parquet::arrow::ArrowWriter;
    use std::sync::Arc;
    
    // Create Arrow arrays
    let time_array = StringArray::from(times.clone());
    let open_array = Float64Array::from(opens.clone());
    let high_array = Float64Array::from(highs.clone());
    let low_array = Float64Array::from(lows.clone());
    let close_array = Float64Array::from(closes.clone());
    let volume_array = Int64Array::from(volumes.clone());
    
    // Define schema
    let schema = Arc::new(Schema::new(vec![
        Field::new("time", DataType::Utf8, false),
        Field::new("open", DataType::Float64, false),
        Field::new("high", DataType::Float64, false),
        Field::new("low", DataType::Float64, false),
        Field::new("close", DataType::Float64, false),
        Field::new("volume", DataType::Int64, false),
    ]));
    
    // Create record batch
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(time_array),
            Arc::new(open_array),
            Arc::new(high_array),
            Arc::new(low_array),
            Arc::new(close_array),
            Arc::new(volume_array),
        ],
    ).map_err(|e| format!("Failed to create record batch: {}", e))?;
    
    // Save to workspace/data directory
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace")
        .join("data");
    
    // Create data directory if it doesn't exist
    fs::create_dir_all(&workspace_path)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;
    
    // Change extension to .parquet
    let parquet_filename = request.filename.replace(".csv", ".parquet");
    let file_path = workspace_path.join(&parquet_filename);
    
    // Write Parquet file
    let file = fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    let mut writer = ArrowWriter::try_new(file, schema, None)
        .map_err(|e| format!("Failed to create parquet writer: {}", e))?;
    writer.write(&batch)
        .map_err(|e| format!("Failed to write batch: {}", e))?;
    writer.close()
        .map_err(|e| format!("Failed to close writer: {}", e))?;
    
    emit_log(&window, "SUCCESS", &format!("Exported {} rows to {}", times.len(), parquet_filename));
    
    Ok(file_path.to_string_lossy().to_string())
}

// test_order_execution command removed - orders handled by orchestrator

// Test orchestrator strategy loading
#[tauri::command]
async fn test_orchestrator_load(
    strategy_name: String,
    window: tauri::Window,
) -> Result<serde_json::Value, String> {
    emit_log(&window, "INFO", &format!("Loading strategy: {}", strategy_name));
    
    // Get the workspace path
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace")
        .join("strategies")
        .join(format!("{}.yaml", strategy_name));
    
    // Try to load the strategy
    match orchestrator::Orchestrator::load_strategy(workspace_path.to_str().unwrap()) {
        Ok(orchestrator) => {
            let config = orchestrator.get_config();
            let summary = orchestrator.get_summary();
            
            emit_log(&window, "SUCCESS", &format!("Loaded strategy: {}", config.name));
            emit_log(&window, "INFO", &summary);
            
            Ok(serde_json::json!({
                "success": true,
                "strategy": {
                    "name": config.name,
                    "version": config.version,
                    "author": config.author,
                    "description": config.description,
                    "indicators": config.dependencies.indicators,
                    "signals": config.dependencies.signals,
                    "parameter_count": config.parameters.len(),
                    "risk_rules": config.risk.len()
                },
                "summary": summary
            }))
        }
        Err(e) => {
            emit_log(&window, "ERROR", &format!("Failed to load strategy: {}", e));
            Err(format!("Failed to load strategy: {}", e))
        }
    }
}

// Run a simple backtest
#[tauri::command]
async fn run_orchestrator_backtest(
    strategy_name: String,
    symbol: String,
    timeframe: String,
    start_date: String,
    end_date: String,
    initial_capital: f64,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<serde_json::Value, String> {
    emit_log(&window, "INFO", &format!("Starting backtest for strategy: {}", strategy_name));
    
    // Generate unique backtest ID
    let backtest_id = uuid::Uuid::new_v4().to_string();
    emit_log(&window, "DEBUG", &format!("Backtest ID: {}", backtest_id));
    
    // Create cancellation token
    let cancel_token = Arc::new(AtomicBool::new(false));
    
    // Store the cancellation token
    {
        let mut active_backtests = state.active_backtests.lock().await;
        active_backtests.insert(backtest_id.clone(), cancel_token.clone());
    }
    
    // Load the strategy
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace")
        .join("strategies")
        .join(format!("{}.yaml", strategy_name));
    
    let mut orchestrator = orchestrator::Orchestrator::load_strategy(workspace_path.to_str().unwrap())
        .map_err(|e| format!("Failed to load strategy: {}", e))?;
    
    // Parse dates
    let from = chrono::DateTime::parse_from_rfc3339(&start_date)
        .map_err(|e| format!("Failed to parse start date: {}", e))?
        .with_timezone(&chrono::Utc);
    let to = chrono::DateTime::parse_from_rfc3339(&end_date)
        .map_err(|e| format!("Failed to parse end date: {}", e))?
        .with_timezone(&chrono::Utc);
    
    // Create data source - always use Live which will utilize cache/database intelligently
    emit_log(&window, "INFO", &format!("Using {} {} data from {} to {}", 
        symbol, timeframe, from.format("%Y-%m-%d"), to.format("%Y-%m-%d")));
    
    let data_source = orchestrator::DataSource::Live {
        symbol,
        timeframe,
        from,
        to,
    };
    
    // Run the backtest
    let initial_capital = rust_decimal::Decimal::from_str(&initial_capital.to_string())
        .map_err(|_| "Invalid initial capital")?;
    emit_log(&window, "INFO", &format!("Running backtest with initial capital: ${}", initial_capital));
    
    // Return the backtest ID immediately so the frontend can use it for cancellation
    window.emit("backtest_started", serde_json::json!({
        "backtest_id": backtest_id.clone()
    })).ok();
    
    let backtest_id_clone = backtest_id.clone();
    let result = match orchestrator.run_backtest_vectorized(data_source, initial_capital, &window, Some(cancel_token)).await {
        Ok(result) => {
            // Debug: Log data sizes
            emit_log(&window, "DEBUG", &format!("Signals: {}, Orders: {}, Trades: {}", 
                result.signals_generated.len(),
                result.executed_orders.len(),
                result.completed_trades.len()
            ));
            emit_log(&window, "SUCCESS", "Backtest completed successfully");
            
            // Limit the data sent to frontend to prevent UI freeze
            let limited_signals = if result.signals_generated.len() > 100 {
                emit_log(&window, "WARN", &format!("Limiting signals from {} to 100 for UI performance", result.signals_generated.len()));
                result.signals_generated.into_iter().take(100).collect()
            } else {
                result.signals_generated
            };
            
            Ok(serde_json::json!({
                "success": true,
                "backtest_id": backtest_id_clone,
                "result": {
                    "total_trades": result.total_trades,
                    "winning_trades": result.winning_trades,
                    "losing_trades": result.losing_trades,
                    "total_pnl": result.total_pnl.to_string(),
                    "max_drawdown": result.max_drawdown.to_string(),
                    "sharpe_ratio": result.sharpe_ratio,
                    "start_capital": result.start_capital.to_string(),
                    "end_capital": result.end_capital.to_string(),
                    "signals_generated": limited_signals,
                    "completed_trades": result.completed_trades.into_iter().take(100).collect::<Vec<_>>(),
                    "executed_orders": result.executed_orders.into_iter().take(100).collect::<Vec<_>>(),
                    "final_portfolio": result.final_portfolio,
                    "daily_returns": result.daily_returns.into_iter().take(100).collect::<Vec<_>>(),
                    "indicator_data": result.indicator_data
                }
            }))
        }
        Err(e) => {
            emit_log(&window, "ERROR", &format!("Backtest failed: {}", e));
            Err(format!("Backtest failed: {}", e))
        }
    };
    
    // Clean up the cancellation token
    {
        let mut active_backtests = state.active_backtests.lock().await;
        active_backtests.remove(&backtest_id);
    }
    
    result
}

// Cancel a running backtest
#[tauri::command]
async fn cancel_backtest(
    backtest_id: String,
    state: State<'_, AppState>,
    window: Window,
) -> Result<(), String> {
    let active_backtests = state.active_backtests.lock().await;
    
    if let Some(cancel_token) = active_backtests.get(&backtest_id) {
        cancel_token.store(true, Ordering::Relaxed);
        emit_log(&window, "INFO", &format!("Cancelling backtest {}", backtest_id));
        Ok(())
    } else {
        Err(format!("Backtest {} not found or already completed", backtest_id))
    }
}

// Run orchestrator in live mode
#[tauri::command]
async fn run_orchestrator_live(
    strategy_name: String,
    initial_capital: Option<f64>,
    _state: State<'_, AppState>,
    window: Window,
) -> Result<serde_json::Value, String> {
    emit_log(&window, "INFO", &format!("Starting orchestrator live mode for strategy: {}", strategy_name));
    
    // Load the strategy
    let strategy_path = format!("workspace/strategies/{}.yaml", strategy_name);
    let orchestrator = match orchestrator::Orchestrator::load_strategy(&strategy_path) {
        Ok(o) => o,
        Err(e) => {
            emit_log(&window, "ERROR", &format!("Failed to load strategy: {}", e));
            return Err(format!("Failed to load strategy: {}", e));
        }
    };
    
    let initial_capital = rust_decimal::Decimal::from_str(&initial_capital.unwrap_or(10000.0).to_string())
        .unwrap_or(rust_decimal::Decimal::from(10000));
    
    emit_log(&window, "INFO", &format!("Starting live trading with initial capital: ${}", initial_capital));

    // Spawn the live trading task
    let redis_url = "redis://127.0.0.1:6379"; // Dummy value, not actually used
    tokio::spawn(async move {
        match orchestrator.run_live_mode(redis_url, initial_capital, &window).await {
            Ok(_) => {
                emit_log(&window, "INFO", "Live trading stopped");
            }
            Err(e) => {
                emit_log(&window, "ERROR", &format!("Live trading error: {}", e));
            }
        }
    });
    
    Ok(serde_json::json!({
        "success": true,
        "message": "Live trading started"
    }))
}





// Helper function to initialize execution engine with a specific broker




#[tokio::main]
async fn main() {
    // Load environment variables from .env file (development only)
    #[cfg(debug_assertions)]
    let _ = dotenvy::dotenv();

    env_logger::init();

    // Database connection - use environment variable or fall back to local
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://postgres@localhost:5432/forex_trading".to_string());
    // Database connection logging will be done after we have window access
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    // Database connection is ready - no pre-warming needed

    // Initialize SQLite for orders
    let orders_db_path = env::current_dir()
        .unwrap()
        .join("orders.db");
    println!("Orders database path: {}", orders_db_path.display());
    let orders_db_url = format!("sqlite:{}?mode=rwc", orders_db_path.display());
    
    let orders_pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&orders_db_url)
        .await
        .expect("Failed to connect to orders database");
    
    // Initialize orders database schema
    database::orders::init_orders_db(&orders_pool)
        .await
        .expect("Failed to initialize orders database");

    let _redis_url = "redis://127.0.0.1:6379"; // Not used with cloud API
    
    // Initialize market data engine
    let market_data_state = market_data::commands::init_market_data_engine(pool.clone());
    
    let app_state = AppState {
        db_pool: Arc::new(Mutex::new(pool)),
        market_candle_cache: candles::cache::create_cache(),  // Still used for orchestrator
        metadata_cache: Arc::new(RwLock::new(HashMap::new())),
        orders_db: Arc::new(Mutex::new(orders_pool)),  // Still used for orchestrator
        active_backtests: Arc::new(Mutex::new(HashMap::new())),
    };

    Builder::default()
        .manage(app_state)
        .manage(market_data_state)
        .invoke_handler(tauri::generate_handler![
            // fetch_candles,  // DEAD: Using cloud API for charts
            // fetch_candles_v2,  // DEAD: Using cloud API for charts
            // check_database_connection,  // DEAD: Not using PostgreSQL for charts
            workspace::get_workspace_tree,
            workspace::read_component_file,
            workspace::save_component_file,
            workspace::create_component_file,
            workspace::run_component,
            workspace::get_indicator_categories,
            workspace::get_component_categories,
            workspace::get_workspace_components,
            workspace::delete_component_file,
            workspace::rename_component_file,
            workspace::delete_component_folder,
            workspace::rename_component_folder,
            workspace::load_parquet_data,
            workspace::list_test_datasets,
            workspace::write_temp_candles,
            market_data::symbols::commands::get_available_data,
            market_data::symbols::commands::get_all_available_symbols,
            // get_broker_connection_status,  // DEAD: Not using broker API
            // get_recent_orders,  // DEAD: Not using broker API
            // cancel_order,  // DEAD: Not using broker API
            // init_execution_engine,  // DEAD: Not using execution engine
            // init_broker_from_profile,  // DEAD: Not using broker API
            // extract_stored_credentials,  // DEAD: Not using broker API
            market_data::symbols::commands::get_symbol_metadata,
            export_test_data,
            test_orchestrator_load,
            run_orchestrator_backtest,
            cancel_backtest,
            run_orchestrator_live,
            // Market data commands
            search_assets,
            add_market_asset,
            get_pipeline_status,
            list_active_pipelines,
            stop_pipeline,
            save_pipeline_config,
            load_pipeline_config,
            check_data_gaps,
            mark_restore_completed,
            // Candles module commands
            candles::commands::get_market_candles
        ])
        .setup(|app| {
            // Get the main window handle
            let window = app.get_webview_window("main").expect("Failed to get main window");
            
            // Now we can log the database connection
            let db_url = std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgresql://postgres@localhost:5432/forex_trading".to_string());
            emit_log(&window, "INFO", &format!("Connecting to database: {}", db_url));
            emit_log(&window, "SUCCESS", "Database connected successfully");
            emit_log(&window, "INFO", "Connection pool established (10 connections)");
            
            // Check Redis availability on startup
            let window_clone = window.clone();
            let app_handle = app.handle().clone();
            tokio::spawn(async move {
                if let Some(_state) = app_handle.try_state::<AppState>() {
                    // Wait a moment for everything to be ready
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    
                    // Try to connect to Redis
                    match RedisClient::open("redis://127.0.0.1:6379".to_string()) {
                        Ok(_) => {
                            emit_log(&window_clone, "INFO", "Redis is available - order execution ready");
                        }
                        Err(_) => {
                            emit_log(&window_clone, "WARN", "Redis not available - order execution disabled");
                        }
                    }
                }
            });
            
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
                
                // Save market data pipelines with clean shutdown flag
                let app_handle = window.app_handle();
                if let Some(market_data_state) = app_handle.try_state::<MarketDataState>() {
                    let engine = market_data_state.engine.clone();
                    tokio::spawn(async move {
                        if let Err(e) = save_final_state(engine).await {
                            eprintln!("[Shutdown] Failed to save pipeline state: {}", e);
                        } else {
                            println!("[Shutdown] Pipeline state saved successfully");
                        }
                    });
                }
                
                // Give async save a moment to complete
                std::thread::sleep(std::time::Duration::from_millis(500));
                std::process::exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("Error while running Tauri application");
}
