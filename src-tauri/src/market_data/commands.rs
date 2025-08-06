// src-tauri/src/market_data/commands.rs

use super::*;
use tauri::{State, Emitter};
use std::sync::Arc;
use tokio::sync::Mutex;

// Add to your AppState
#[derive(Clone)]
pub struct MarketDataState {
    pub engine: Arc<Mutex<MarketDataEngine>>,
}

#[derive(Serialize, Deserialize)]
pub struct AddAssetRequest {
    pub symbol: String,
    pub source: Option<String>, // "kraken", "oanda", etc.
    pub account_id: Option<String>,
    pub api_token: Option<String>,
    pub profile_id: Option<String>, // Specific broker profile to use
    pub catchup_from: Option<String>, // ISO timestamp to catch up from
}

#[derive(Serialize, Deserialize)]
pub struct AssetSearchResult {
    pub symbol: String,
    pub name: String,
    pub asset_class: String,
    pub available_sources: Vec<String>,
    pub is_available: bool,
}

#[derive(Serialize, Deserialize)]
pub struct PipelineStatusResponse {
    pub symbol: String,
    pub status: String,
    pub connected: bool,
    pub last_tick: Option<String>,
    pub source: String,
}

#[tauri::command]
pub async fn search_assets(
    query: String,
) -> Result<Vec<AssetSearchResult>, String> {
    let query = query.to_uppercase();
    let mut results = Vec::new();
    
    // Common forex pairs
    let forex_pairs = vec![
        ("EURUSD", "Euro / US Dollar"),
        ("GBPUSD", "British Pound / US Dollar"),
        ("USDJPY", "US Dollar / Japanese Yen"),
        ("AUDUSD", "Australian Dollar / US Dollar"),
        ("USDCAD", "US Dollar / Canadian Dollar"),
        ("NZDUSD", "New Zealand Dollar / US Dollar"),
        ("USDCHF", "US Dollar / Swiss Franc"),
    ];
    
    // Common crypto pairs
    let crypto_pairs = vec![
        ("BTCUSD", "Bitcoin / US Dollar"),
        ("ETHUSD", "Ethereum / US Dollar"),
        ("SOLUSD", "Solana / US Dollar"),
        ("AVAXUSD", "Avalanche / US Dollar"),
        ("LINKUSD", "Chainlink / US Dollar"),
        ("DOTUSD", "Polkadot / US Dollar"),
        ("MATICUSD", "Polygon / US Dollar"),
    ];
    
    // Common stocks
    let stocks = vec![
        ("AAPL", "Apple Inc."),
        ("MSFT", "Microsoft Corporation"),
        ("GOOGL", "Alphabet Inc."),
        ("AMZN", "Amazon.com Inc."),
        ("TSLA", "Tesla Inc."),
        ("META", "Meta Platforms Inc."),
        ("NVDA", "NVIDIA Corporation"),
    ];
    
    // Search forex
    for (symbol, name) in forex_pairs {
        if symbol.contains(&query) || name.to_uppercase().contains(&query) {
            results.push(AssetSearchResult {
                symbol: symbol.to_string(),
                name: name.to_string(),
                asset_class: "forex".to_string(),
                available_sources: vec!["oanda".to_string(), "dukascopy".to_string()],
                is_available: true,
            });
        }
    }
    
    // Search crypto
    for (symbol, name) in crypto_pairs {
        if symbol.contains(&query) || name.to_uppercase().contains(&query) {
            results.push(AssetSearchResult {
                symbol: symbol.to_string(),
                name: name.to_string(),
                asset_class: "crypto".to_string(),
                available_sources: vec!["kraken".to_string(), "coinbase".to_string()],
                is_available: true,
            });
        }
    }
    
    // Search stocks
    for (symbol, name) in stocks {
        if symbol.contains(&query) || name.to_uppercase().contains(&query) {
            results.push(AssetSearchResult {
                symbol: symbol.to_string(),
                name: name.to_string(),
                asset_class: "stock".to_string(),
                available_sources: vec!["alpaca".to_string()],
                is_available: true,
            });
        }
    }
    
    // If exact match not found, try to identify the asset
    if results.is_empty() && !query.is_empty() {
        if let Ok(asset_info) = AssetDiscovery::identify(&query).await {
            let sources: Vec<String> = asset_info.available_sources.iter()
                .map(|s| match s {
                    DataSource::Kraken { .. } => "kraken",
                    DataSource::Oanda { .. } => "oanda",
                    DataSource::Alpaca { .. } => "alpaca",
                    DataSource::Dukascopy => "dukascopy",
                    DataSource::IBKR { .. } => "ibkr",
                    DataSource::Coinbase { .. } => "coinbase",
                })
                .map(|s| s.to_string())
                .collect();
            
            results.push(AssetSearchResult {
                symbol: asset_info.symbol.clone(),
                name: format!("{:?} - {}", asset_info.class, asset_info.symbol),
                asset_class: format!("{:?}", asset_info.class).to_lowercase(),
                available_sources: sources,
                is_available: true,
            });
        }
    }
    
    Ok(results)
}

#[tauri::command]
pub async fn add_market_asset(
    request: AddAssetRequest,
    state: State<'_, MarketDataState>,
    window: tauri::Window,
) -> Result<String, String> {
    println!("[Command] Adding asset: {} with source: {:?}", request.symbol, request.source);
    
    let mut engine = state.engine.lock().await;
    
    // Get profile information if profile_id is provided
    let (profile_id, profile_name) = if let Some(pid) = &request.profile_id {
        (Some(pid.clone()), None) // Profile name could be looked up from broker store
    } else {
        (None, None)
    };
    
    // Convert source string to DataSource enum
    let source = match request.source.as_deref() {
        Some("kraken") => Some(DataSource::Kraken { 
            api_key: None, 
            api_secret: None 
        }),
        Some("oanda") => {
            // Require credentials from the request (no env var fallback)
            match (request.account_id.clone(), request.api_token.clone()) {
                (Some(account_id), Some(api_token)) if !account_id.is_empty() && !api_token.is_empty() => {
                    Some(DataSource::Oanda { account_id, api_token })
                },
                _ => {
                    eprintln!("[Command] Missing or empty OANDA credentials");
                    return Err("OANDA requires account_id and api_token".to_string());
                }
            }
        },
        _ => None,
    };
    
    // Add the asset
    match engine.add_asset(request.symbol.clone(), source, profile_id, profile_name).await {
        Ok(_) => {
            // Emit event to frontend
            window.emit("asset-added", &request.symbol).ok();
            
            // Start cascade refresh for this asset
            let cascade_procedure = engine.pipelines.get(&request.symbol)
                .map(|p| p.config.cascade_procedure.clone());
            
            if let Some(procedure) = cascade_procedure {
                engine.cascade_scheduler.schedule_cascade(
                    procedure,
                    5 // Every 5 seconds
                ).await;
            }
            
            // Handle catchup if requested
            if let Some(catchup_from) = request.catchup_from {
                eprintln!("[Command] Initiating catchup for {} from {}", request.symbol, catchup_from);
                
                // Parse the timestamp
                if let Ok(from_time) = chrono::DateTime::parse_from_rfc3339(&catchup_from) {
                    let from_utc = from_time.with_timezone(&chrono::Utc);
                    let now = chrono::Utc::now();
                    let gap_minutes = (now - from_utc).num_minutes();
                    
                    eprintln!("[Command] Gap detected: {} minutes for {}", gap_minutes, request.symbol);
                    
                    // TODO: Implement actual historical data fetch
                    // For now, just log the gap
                    window.emit("catchup-status", serde_json::json!({
                        "symbol": request.symbol,
                        "gap_minutes": gap_minutes,
                        "status": "Gap detected, catchup not yet implemented"
                    })).ok();
                }
            }
            
            // Trigger immediate save - extract Arc before spawning
            let engine_arc = state.engine.clone();
            tokio::spawn(async move {
                if let Err(e) = save_engine_state(engine_arc).await {
                    eprintln!("[Command] Failed to save config after add: {}", e);
                }
            });
            
            Ok(format!("Successfully added {}", request.symbol))
        }
        Err(e) => {
            eprintln!("[Command] Error adding asset: {}", e);
            Err(format!("Failed to add asset: {}", e))
        }
    }
}

#[tauri::command]
pub async fn get_pipeline_status(
    symbol: String,
    state: State<'_, MarketDataState>,
) -> Result<PipelineStatusResponse, String> {
    let engine = state.engine.lock().await;
    
    if let Some(pipeline) = engine.pipelines.get(&symbol) {
        let status = pipeline.status.lock().await;
        let (status_str, connected, last_tick) = match &*status {
            PipelineStatus::Stopped => ("stopped".to_string(), false, None),
            PipelineStatus::Starting => ("starting".to_string(), false, None),
            PipelineStatus::Running { connected, last_tick } => {
                ("running".to_string(), *connected, last_tick.map(|t| t.to_rfc3339()))
            },
            PipelineStatus::Error { message } => (format!("error: {}", message), false, None),
        };
        
        let source_name = match &pipeline.config.source {
            DataSource::Kraken { .. } => "kraken",
            DataSource::Oanda { .. } => "oanda",
            DataSource::Alpaca { .. } => "alpaca",
            DataSource::Dukascopy => "dukascopy",
            DataSource::IBKR { .. } => "ibkr",
            DataSource::Coinbase { .. } => "coinbase",
        };
        
        Ok(PipelineStatusResponse {
            symbol,
            status: status_str,
            connected,
            last_tick,
            source: source_name.to_string(),
        })
    } else {
        Err(format!("Pipeline not found for symbol: {}", symbol))
    }
}

#[tauri::command]
pub async fn list_active_pipelines(
    state: State<'_, MarketDataState>,
) -> Result<Vec<PipelineStatusResponse>, String> {
    let engine = state.engine.lock().await;
    let mut results = Vec::new();
    
    for (symbol, pipeline) in &engine.pipelines {
        let status = pipeline.status.lock().await;
        let (status_str, connected, last_tick) = match &*status {
            PipelineStatus::Stopped => ("stopped".to_string(), false, None),
            PipelineStatus::Starting => ("starting".to_string(), false, None),
            PipelineStatus::Running { connected, last_tick } => {
                ("running".to_string(), *connected, last_tick.map(|t| t.to_rfc3339()))
            },
            PipelineStatus::Error { message } => (format!("error: {}", message), false, None),
        };
        
        let source_name = match &pipeline.config.source {
            DataSource::Kraken { .. } => "kraken",
            DataSource::Oanda { .. } => "oanda",
            DataSource::Alpaca { .. } => "alpaca",
            DataSource::Dukascopy => "dukascopy",
            DataSource::IBKR { .. } => "ibkr",
            DataSource::Coinbase { .. } => "coinbase",
        };
        
        results.push(PipelineStatusResponse {
            symbol: symbol.clone(),
            status: status_str,
            connected,
            last_tick,
            source: source_name.to_string(),
        });
    }
    
    Ok(results)
}

#[tauri::command]
pub async fn stop_pipeline(
    symbol: String,
    state: State<'_, MarketDataState>,
) -> Result<String, String> {
    let mut engine = state.engine.lock().await;
    
    if let Some(pipeline) = engine.pipelines.remove(&symbol) {
        // Stop the ingester
        if let Some(mut ingester) = pipeline.ingester {
            if let Err(e) = ingester.disconnect().await {
                eprintln!("[Command] Error disconnecting ingester: {}", e);
            }
        }
        
        {
            let mut status = pipeline.status.lock().await;
            *status = PipelineStatus::Stopped;
        }
        
        Ok(format!("Stopped pipeline for {}", symbol))
    } else {
        Err(format!("Pipeline not found for symbol: {}", symbol))
    }
}

// Pipeline persistence structures
#[derive(Serialize, Deserialize)]
pub struct PipelineConfigFile {
    pub version: u32,
    pub pipelines: Vec<PipelineConfig>,
    pub saved_at: String,
    pub clean_shutdown: bool,
}

#[derive(Serialize, Deserialize)]
pub struct PipelineConfig {
    pub symbol: String,
    pub source: String,
    pub asset_class: String,
    pub added_at: String,
    pub last_tick: Option<String>,
    pub profile_id: Option<String>, // Which broker profile this pipeline uses
    pub profile_name: Option<String>, // Display name for UI
}

#[tauri::command]
pub async fn save_pipeline_config(
    state: State<'_, MarketDataState>,
) -> Result<(), String> {
    let engine = state.engine.lock().await;
    
    // Extract current pipeline configurations
    let mut configs = Vec::new();
    for (symbol, pipeline) in engine.pipelines.iter() {
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
        
        configs.push(PipelineConfig {
            symbol: symbol.clone(),
            source: source_name.to_string(),
            asset_class: format!("{:?}", pipeline.config.asset_class).to_lowercase(),
            added_at: chrono::Utc::now().to_rfc3339(),
            last_tick: last_tick_str,
            profile_id: pipeline.config.profile_id.clone(),
            profile_name: pipeline.config.profile_name.clone(),
        });
    }
    
    let config_file = PipelineConfigFile {
        version: 1,
        pipelines: configs,
        saved_at: chrono::Utc::now().to_rfc3339(),
        clean_shutdown: false,  // Will be set to true on graceful shutdown
    };
    
    // Get app config directory using dirs crate
    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("sptraderb");
    
    // Ensure directory exists
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    
    let config_path = config_dir.join("active_pipelines.json");
    let json = serde_json::to_string_pretty(&config_file)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    std::fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    
    println!("[MarketData] Saved {} pipeline configs to {:?}", config_file.pipelines.len(), config_path);
    Ok(())
}

#[tauri::command]
pub async fn load_pipeline_config() -> Result<PipelineConfigFile, String> {
    // Note: This needs app handle but we can't get it without State
    // Will need to pass config path from frontend or refactor
    let config_path = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("sptraderb")
        .join("active_pipelines.json");
    
    if !config_path.exists() {
        return Ok(PipelineConfigFile {
            version: 1,
            pipelines: vec![],
            saved_at: chrono::Utc::now().to_rfc3339(),
            clean_shutdown: true,  // No previous file means clean start
        });
    }
    
    let json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;
    
    let config_file: PipelineConfigFile = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse config file: {}", e))?;
    
    println!("[MarketData] Loaded {} pipeline configs", config_file.pipelines.len());
    Ok(config_file)
}

// Helper function to save engine state (works with Arc directly)
async fn save_engine_state(engine: Arc<Mutex<MarketDataEngine>>) -> Result<(), String> {
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
            
            configs.push(PipelineConfig {
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
    }; // Lock released here
    
    save_configs_to_file(configs).await
}

// Standalone function to save configs to file
async fn save_configs_to_file(configs: Vec<PipelineConfig>) -> Result<(), String> {
    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("sptraderb");
    
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    
    let config_file = PipelineConfigFile {
        version: 1,
        pipelines: configs,
        saved_at: chrono::Utc::now().to_rfc3339(),
        clean_shutdown: false,  // Will be set to true on graceful shutdown
    };
    
    let config_path = config_dir.join("active_pipelines.json");
    let json = serde_json::to_string_pretty(&config_file)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    std::fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    
    Ok(())
}

// Initialize market data engine in main.rs
pub fn init_market_data_engine(pool: PgPool) -> MarketDataState {
    let engine = Arc::new(Mutex::new(MarketDataEngine::new(pool)));
    
    // Start auto-save task
    MarketDataEngine::start_auto_save(engine.clone());
    
    MarketDataState { engine }
}

#[tauri::command]
pub async fn mark_restore_completed(
    state: State<'_, MarketDataState>,
) -> Result<(), String> {
    let mut engine = state.engine.lock().await;
    engine.restore_completed = true;
    eprintln!("[MarketData] Restore marked as completed, auto-save now enabled");
    Ok(())
}