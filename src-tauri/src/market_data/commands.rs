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
    
    // Convert source string to DataSource enum
    let source = match request.source.as_deref() {
        Some("kraken") => Some(DataSource::Kraken { 
            api_key: None, 
            api_secret: None 
        }),
        Some("oanda") => {
            Some(DataSource::Oanda {
                account_id: request.account_id.clone()
                    .unwrap_or_else(|| std::env::var("OANDA_ACCOUNT_ID").unwrap_or_default()),
                api_token: request.api_token.clone()
                    .unwrap_or_else(|| std::env::var("OANDA_API_TOKEN").unwrap_or_default()),
            })
        },
        _ => None,
    };
    
    // Add the asset
    match engine.add_asset(request.symbol.clone(), source).await {
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
        let (status_str, connected, last_tick) = match &pipeline.status {
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
        let (status_str, connected, last_tick) = match &pipeline.status {
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
    
    if let Some(mut pipeline) = engine.pipelines.remove(&symbol) {
        // Stop the ingester
        if let Some(mut ingester) = pipeline.ingester {
            if let Err(e) = ingester.disconnect().await {
                eprintln!("[Command] Error disconnecting ingester: {}", e);
            }
        }
        
        pipeline.status = PipelineStatus::Stopped;
        
        Ok(format!("Stopped pipeline for {}", symbol))
    } else {
        Err(format!("Pipeline not found for symbol: {}", symbol))
    }
}

// Initialize market data engine in main.rs
pub fn init_market_data_engine(pool: PgPool) -> MarketDataState {
    MarketDataState {
        engine: Arc::new(Mutex::new(MarketDataEngine::new(pool))),
    }
}