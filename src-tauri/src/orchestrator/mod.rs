use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use chrono::{DateTime, Utc, Datelike, TimeZone};
use rust_decimal::Decimal;
use rust_decimal::prelude::*;
use std::str::FromStr;
use tauri::{Emitter, Window, Manager};
use serde_json::Value;
use uuid::Uuid;
use redis::{AsyncCommands, Client as RedisClient};
use redis::streams::{StreamReadOptions, StreamReadReply};

mod component_runner;
use component_runner::{run_component_for_candle, initialize_component_executor, shutdown_component_executor};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Orchestrator {
    strategy_config: StrategyConfig,
    #[serde(skip)]
    signal_metadata_cache: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyConfig {
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub dependencies: Dependencies,
    pub parameters: HashMap<String, serde_yaml::Value>,
    pub entry: serde_yaml::Value,
    pub exit: serde_yaml::Value,
    pub risk: HashMap<String, serde_yaml::Value>,
    #[serde(default)]
    pub signal_config: HashMap<String, serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dependencies {
    pub indicators: Vec<String>,
    pub signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DataSource {
    Live {
        symbol: String,
        timeframe: String,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    },
    Parquet {
        filename: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candle {
    pub time: DateTime<Utc>,
    pub open: Decimal,
    pub high: Decimal,
    pub low: Decimal,
    pub close: Decimal,
    pub volume: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestResult {
    pub total_trades: i32,
    pub winning_trades: i32,
    pub losing_trades: i32,
    pub total_pnl: Decimal,
    pub max_drawdown: Decimal,
    pub sharpe_ratio: f64,
    pub start_capital: Decimal,
    pub end_capital: Decimal,
    pub signals_generated: Vec<SignalEvent>,
    pub order_decisions: Vec<OrderDecision>,
    pub executed_orders: Vec<crate::orders::Order>,
    pub completed_trades: Vec<Trade>,
    pub final_portfolio: Portfolio,
    pub daily_returns: Vec<(DateTime<Utc>, Decimal)>,
    pub indicator_data: HashMap<String, Vec<Option<f64>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalEvent {
    pub timestamp: DateTime<Utc>,
    pub signal_name: String,
    pub signal_type: String,
    pub strength: f64,
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub entry_price: Decimal,
    pub size: Decimal,
    pub entry_time: DateTime<Utc>,
    pub triggering_signal: String,
    pub stop_loss: Option<Decimal>,
    pub take_profit: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PositionSide {
    Long,
    Short,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderDecision {
    pub timestamp: DateTime<Utc>,
    pub action: OrderAction,
    pub symbol: String,
    pub reason: String,
    pub triggering_signal: SignalEvent,
    pub size_percentage: f64,  // Will be converted to actual size in step 5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderAction {
    Buy,
    Sell,
    CloseAll,
    ClosePosition(String),  // position id
}

#[derive(Debug, Clone, Default)]
pub struct PositionTracker {
    pub positions: HashMap<String, Position>,
    pub closed_positions: Vec<Position>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub symbol: String,
    pub side: PositionSide,
    pub entry_time: DateTime<Utc>,
    pub entry_price: Decimal,
    pub exit_time: DateTime<Utc>,
    pub exit_price: Decimal,
    pub quantity: Decimal,
    pub pnl: Decimal,
    pub pnl_percent: Decimal,
    pub exit_reason: String,
    pub holding_period_hours: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Portfolio {
    pub cash: Decimal,
    pub positions: HashMap<String, Position>,
    pub total_value: Decimal,
    pub daily_pnl: Decimal,
    pub total_pnl: Decimal,
    pub max_drawdown: Decimal,
    pub high_water_mark: Decimal,
    pub initial_capital: Decimal,
    pub current_date: DateTime<Utc>,
}

impl Portfolio {
    pub fn new(initial_capital: Decimal) -> Self {
        Self {
            cash: initial_capital,
            positions: HashMap::new(),
            total_value: initial_capital,
            daily_pnl: Decimal::ZERO,
            total_pnl: Decimal::ZERO,
            max_drawdown: Decimal::ZERO,
            high_water_mark: initial_capital,
            initial_capital,
            current_date: Utc::now(),
        }
    }
    
    pub fn update_value(&mut self, current_prices: &HashMap<String, Decimal>) {
        // Calculate total value including positions
        let mut position_value = Decimal::ZERO;
        
        for (symbol, position) in &self.positions {
            if let Some(price) = current_prices.get(symbol) {
                let value = position.size * price;
                position_value += value;
            }
        }
        
        self.total_value = self.cash + position_value;
        
        // Update total P&L
        self.total_pnl = self.total_value - self.initial_capital;
        
        // Update high water mark and drawdown
        if self.total_value > self.high_water_mark {
            self.high_water_mark = self.total_value;
        }
        
        let drawdown = (self.high_water_mark - self.total_value) / self.high_water_mark;
        if drawdown > self.max_drawdown {
            self.max_drawdown = drawdown;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskManager {
    pub max_drawdown_limit: Decimal,
    pub daily_loss_limit: Decimal,
    pub position_size_limit: Decimal,
    pub max_positions: usize,
    pub stop_loss_percent: Decimal,
    pub take_profit_percent: Decimal,
}

impl RiskManager {
    pub fn from_strategy_config(config: &StrategyConfig) -> Self {
        let max_drawdown = config.risk.get("max_drawdown")
            .and_then(|v| v.as_f64())
            .and_then(|f| Decimal::from_f64(f))
            .unwrap_or(Decimal::from_str("0.15").unwrap());
            
        let daily_loss_limit = config.risk.get("daily_loss_limit")
            .and_then(|v| v.as_f64())
            .and_then(|f| Decimal::from_f64(f))
            .unwrap_or(Decimal::from_str("0.03").unwrap());
            
        let position_limit = config.risk.get("position_limit")
            .and_then(|v| v.as_f64())
            .and_then(|f| Decimal::from_f64(f))
            .unwrap_or(Decimal::from_str("0.05").unwrap());
            
        let max_positions = config.parameters.get("max_positions")
            .and_then(|v| v.as_i64())
            .unwrap_or(1) as usize;
            
        let stop_loss = config.parameters.get("stop_loss")
            .and_then(|v| v.as_f64())
            .and_then(|f| Decimal::from_f64(f))
            .unwrap_or(Decimal::from_str("0.02").unwrap());
            
        let take_profit = config.parameters.get("take_profit")
            .and_then(|v| v.as_f64())
            .and_then(|f| Decimal::from_f64(f))
            .unwrap_or(Decimal::from_str("0.04").unwrap());
            
        Self {
            max_drawdown_limit: max_drawdown,
            daily_loss_limit,
            position_size_limit: position_limit,
            max_positions,
            stop_loss_percent: stop_loss,
            take_profit_percent: take_profit,
        }
    }
    
    pub fn check_risk_limits(&self, portfolio: &Portfolio) -> Result<(), String> {
        // Check max drawdown
        if portfolio.max_drawdown > self.max_drawdown_limit {
            return Err(format!("Max drawdown limit exceeded: {:.2}% > {:.2}%", 
                portfolio.max_drawdown * Decimal::from(100), 
                self.max_drawdown_limit * Decimal::from(100)));
        }
        
        // Check daily loss limit
        let daily_loss_pct = -portfolio.daily_pnl / portfolio.initial_capital;
        if daily_loss_pct > self.daily_loss_limit {
            return Err(format!("Daily loss limit exceeded: {:.2}% > {:.2}%",
                daily_loss_pct * Decimal::from(100),
                self.daily_loss_limit * Decimal::from(100)));
        }
        
        Ok(())
    }
    
    pub fn should_stop_trading(&self, portfolio: &Portfolio) -> bool {
        // Check if any risk limits are exceeded
        self.check_risk_limits(portfolio).is_err()
    }
    
    pub fn can_open_position(&self, portfolio: &Portfolio, position_size: &Decimal) -> bool {
        // Check if we can open a new position given risk limits
        // For now, just check basic limits
        portfolio.positions.len() < self.max_positions &&
        *position_size <= self.position_size_limit
    }
}

impl Orchestrator {
    /// Convert Python module notation to file path
    fn convert_module_path_to_file_path(module_path: &str) -> String {
        if module_path.ends_with(".py") {
            module_path.to_string()
        } else {
            format!("{}.py", module_path.replace(".", "/"))
        }
    }
    
    /// Load a strategy from a YAML file
    pub fn load_strategy(path: &str) -> Result<Self, String> {
        // Read the YAML file
        let yaml_content = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read strategy file: {}", e))?;
        
        // Parse the YAML
        let strategy_config: StrategyConfig = serde_yaml::from_str(&yaml_content)
            .map_err(|e| format!("Failed to parse strategy YAML: {}", e))?;
        
        Ok(Orchestrator { 
            strategy_config,
            signal_metadata_cache: HashMap::new(),
        })
    }
    
    /// Get the strategy configuration
    pub fn get_config(&self) -> &StrategyConfig {
        &self.strategy_config
    }
    
    /// Get a friendly summary of the strategy
    pub fn get_summary(&self) -> String {
        format!(
            "Strategy: {} v{}\nAuthor: {}\nDescription: {}\nIndicators: {}\nSignals: {}\nParameters: {}",
            self.strategy_config.name,
            self.strategy_config.version,
            self.strategy_config.author,
            self.strategy_config.description,
            self.strategy_config.dependencies.indicators.len(),
            self.strategy_config.dependencies.signals.len(),
            self.strategy_config.parameters.len()
        )
    }
    
    /// Run a backtest with the given data source (vectorized processing)
    pub async fn run_backtest_vectorized(
        &mut self,
        data_source: DataSource,
        initial_capital: Decimal,
        window: &Window,
        cancel_token: Option<Arc<std::sync::atomic::AtomicBool>>,
    ) -> Result<BacktestResult, String> {
        use std::process::Command;
        use std::io::Write;
        
        // Load all candles first
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": "Loading market data for vectorized backtest..."
        })).ok();
        
        let candles = self.load_candles(&data_source, window).await?;
        
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": format!("Running vectorized calculation on {} candles", candles.len())
        })).ok();
        
        // Convert candles to simple format for Python
        let candle_data: Vec<serde_json::Value> = candles.iter().map(|c| {
            serde_json::json!({
                "time": c.time.timestamp(),
                "open": c.open.to_f64().unwrap_or(0.0),
                "high": c.high.to_f64().unwrap_or(0.0),
                "low": c.low.to_f64().unwrap_or(0.0),
                "close": c.close.to_f64().unwrap_or(0.0),
                "volume": c.volume
            })
        }).collect();
        
        // Run vectorized Python calculation
        let input_data = serde_json::json!({
            "candles": candle_data,
            "strategy_config": self.strategy_config
        });
        
        let current_dir = std::env::current_dir()
            .map_err(|e| e.to_string())?;
        let workspace_dir = current_dir.parent()
            .ok_or("Failed to get parent directory")?
            .join("workspace");
        let script_path = workspace_dir
            .join("core")
            .join("utils")
            .join("vectorized_backtest_v2.py");
            
        window.emit("log", serde_json::json!({
            "level": "DEBUG",
            "message": format!("Python script path: {:?}", script_path)
        })).ok();
        
        // Check if the script exists
        if !script_path.exists() {
            return Err(format!("Python script not found at: {:?}", script_path));
        }
            
        let mut child = Command::new("python3")
            .arg(&script_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start Python process: {} (script: {:?})", e, script_path))?;
            
        // Send input data
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(serde_json::to_string(&input_data)
                .map_err(|e| format!("Failed to serialize input data: {}", e))?
                .as_bytes())
                .map_err(|e| format!("Failed to write to Python process: {}", e))?;
        }
        
        // Wait for result
        let output = child.wait_with_output()
            .map_err(|e| format!("Failed to get Python output: {}", e))?;
            
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Python process failed: {}", stderr));
        }
        
        // Parse result
        let result: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Failed to parse Python output: {}", e))?;
            
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": format!("Vectorized calculation completed in {}ms", 
                result["stats"]["calculation_time_ms"].as_f64().unwrap_or(0.0))
        })).ok();
        
        // Convert signals to our format
        let mut all_signals = Vec::new();
        if let Some(signals) = result["signals"].as_array() {
            for signal in signals {
                // Get timestamp string
                let timestamp_str = signal["timestamp"].as_str()
                    .ok_or_else(|| format!("Missing timestamp in signal: {:?}", signal))?;
                
                // Parse timestamp
                let timestamp = DateTime::parse_from_rfc3339(timestamp_str)
                    .map_err(|e| format!("Failed to parse timestamp '{}': {}", timestamp_str, e))?
                    .with_timezone(&Utc);
                
                all_signals.push(SignalEvent {
                    timestamp,
                    signal_name: signal["signal_name"].as_str().unwrap_or("unknown").to_string(),
                    signal_type: signal["signal_type"].as_str().unwrap_or("unknown").to_string(),
                    strength: signal["strength"].as_f64().unwrap_or(1.0),
                    metadata: signal["metadata"].as_object()
                        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                        .unwrap_or_default(),
                });
            }
        }
        
        // Extract indicator data
        let mut indicator_data = HashMap::new();
        if let Some(indicators) = result["indicators"].as_object() {
            for (name, values) in indicators {
                if let Some(value_array) = values.as_array() {
                    let float_values: Vec<Option<f64>> = value_array.iter()
                        .map(|v| v.as_f64())
                        .collect();
                    indicator_data.insert(name.clone(), float_values);
                }
            }
        }
        
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": format!("Found {} signals from vectorized calculation", all_signals.len())
        })).ok();

        // Now run the actual backtest simulation with the pre-calculated signals
        let mut portfolio = Portfolio::new(initial_capital);
        let risk_manager = RiskManager::from_strategy_config(&self.strategy_config);
        let mut position_tracker = PositionTracker::default();
        let mut order_decisions = Vec::new();
        let mut executed_orders = Vec::new();
        let mut completed_trades = Vec::new();
        let mut daily_returns = Vec::new();
        let mut last_portfolio_date = None;
        
        // Process candles with signals
        for (i, candle) in candles.iter().enumerate() {
            // Check cancellation
            if let Some(token) = &cancel_token {
                if token.load(std::sync::atomic::Ordering::Relaxed) {
                    window.emit("log", serde_json::json!({
                        "level": "WARN",
                        "message": "Backtest cancelled by user"
                    })).ok();
                    return Err("Backtest cancelled".to_string());
                }
            }

            // Get signals for this candle timestamp
            let candle_signals: Vec<_> = all_signals.iter()
                .filter(|s| s.timestamp == candle.time)
                .cloned()
                .collect();

            // Update portfolio date and value
            portfolio.current_date = candle.time;
            let symbol = match &data_source {
                DataSource::Live { symbol, .. } => symbol.clone(),
                DataSource::Parquet { .. } => "EURUSD".to_string(),
            };
            let mut current_prices = HashMap::new();
            current_prices.insert(symbol, candle.close);
            portfolio.update_value(&current_prices);

            // Check exits
            let new_trades = self.check_position_exits(
                candle,
                &mut portfolio,
                &mut position_tracker,
                &candle_signals,
                window,
            );
            completed_trades.extend(new_trades);

            // Evaluate entries
            if !candle_signals.is_empty() {
                window.emit("log", serde_json::json!({
                    "level": "DEBUG",
                    "message": format!("Evaluating {} signals for candle at {}", candle_signals.len(), candle.time)
                })).ok();
                
                let decisions = self.evaluate_entry_conditions(
                    &candle_signals,
                    &position_tracker,
                    &data_source,
                );
                
                for decision in decisions {
                    if risk_manager.can_open_position(&portfolio, &Decimal::from_f64(decision.size_percentage).unwrap_or(Decimal::ZERO)) {
                        let quantity = self.calculate_position_size(
                            &decision,
                            &portfolio,
                            candle.close,
                            &risk_manager,
                        )?;
                        
                        if quantity > Decimal::ZERO {
                            let order = self.create_order_from_decision(
                                &decision,
                                quantity,
                                candle.close,
                                &risk_manager,
                            );
                            
                            self.execute_order_simulated(
                                &order,
                                candle.close,
                                &mut portfolio,
                                &mut position_tracker,
                                window,
                            )?;
                            
                            executed_orders.push(order);
                            order_decisions.push(decision);
                        }
                    }
                }
            }

            // Track daily returns
            let current_date = candle.time.date_naive();
            if last_portfolio_date.is_none() || last_portfolio_date != Some(current_date) {
                daily_returns.push((candle.time, portfolio.daily_pnl));
                last_portfolio_date = Some(current_date);
            }

            // Progress update every 100 candles
            if i % 100 == 0 {
                window.emit("backtest_progress", serde_json::json!({
                    "current": i,
                    "total": candles.len(),
                    "percentage": (i as f64 / candles.len() as f64 * 100.0) as u32
                })).ok();
            }
        }

        // Final calculations
        let sharpe_ratio = Self::calculate_sharpe_ratio(&daily_returns);
        
        let result = BacktestResult {
            total_trades: completed_trades.len() as i32,
            winning_trades: completed_trades.iter().filter(|t| t.pnl > Decimal::ZERO).count() as i32,
            losing_trades: completed_trades.iter().filter(|t| t.pnl < Decimal::ZERO).count() as i32,
            total_pnl: portfolio.total_pnl,
            max_drawdown: portfolio.max_drawdown,
            sharpe_ratio,
            start_capital: initial_capital,
            end_capital: portfolio.total_value,
            signals_generated: all_signals,
            order_decisions,
            executed_orders,
            completed_trades,
            final_portfolio: portfolio,
            daily_returns,
            indicator_data,
        };

        window.emit("log", serde_json::json!({
            "level": "SUCCESS",
            "message": format!("Vectorized backtest completed. Total P&L: {}", result.total_pnl)
        })).ok();

        Ok(result)
    }
    
    /// Run a backtest with the given data source (chronological processing)
    /// DEPRECATED: This method now redirects to run_backtest_vectorized for performance
    pub async fn run_backtest(
        &mut self,
        data_source: DataSource,
        initial_capital: Decimal,
        window: &Window,
        cancel_token: Option<Arc<std::sync::atomic::AtomicBool>>,
    ) -> Result<BacktestResult, String> {
        // Log deprecation warning
        window.emit("log", serde_json::json!({
            "level": "WARN",
            "message": "DEPRECATED: run_backtest() called - redirecting to run_backtest_vectorized() for better performance"
        })).ok();
        
        // Redirect to vectorized implementation
        self.run_backtest_vectorized(data_source, initial_capital, window, cancel_token).await
    }
    
    /// Original run_backtest implementation (preserved for reference)
    /// This method processes candles one by one, calling Python for each candle
    #[allow(dead_code)]
    async fn run_backtest_original(
        &mut self,
        data_source: DataSource,
        initial_capital: Decimal,
        window: &Window,
        cancel_token: Option<Arc<std::sync::atomic::AtomicBool>>,
    ) -> Result<BacktestResult, String> {
        // Initialize component executor
        initialize_component_executor()
            .map_err(|e| format!("Failed to initialize component executor: {}", e))?;
        
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": "Component executor initialized"
        })).ok();
        
        // Load candle data
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": "Loading market data for backtest..."
        })).ok();
        
        let candles = self.load_candles(&data_source, window).await?;
        
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": format!("Loaded {} candles for backtesting", candles.len())
        })).ok();
        
        // Initialize portfolio and tracking
        let mut portfolio = Portfolio::new(initial_capital);
        let risk_manager = RiskManager::from_strategy_config(&self.strategy_config);
        let mut position_tracker = PositionTracker::default();
        let mut executed_orders = Vec::new();
        let mut completed_trades = Vec::new();
        let mut daily_returns = Vec::new();
        let mut all_signals: Vec<SignalEvent> = Vec::new();
        let mut all_indicator_data: HashMap<String, Vec<Option<f64>>> = HashMap::new();
        
        // Pre-fetch metadata for all signals
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": "Loading signal metadata..."
        })).ok();
        
        for signal_path in &self.strategy_config.dependencies.signals {
            let signal_file_path = Self::convert_module_path_to_file_path(signal_path);
            
            // Try to get metadata and cache it
            match self.get_signal_metadata(&signal_file_path, window).await {
                Ok(metadata) => {
                    self.signal_metadata_cache.insert(signal_file_path.clone(), metadata);
                    window.emit("log", serde_json::json!({
                        "level": "DEBUG",
                        "message": format!("Cached metadata for signal: {}", signal_path)
                    })).ok();
                }
                Err(e) => {
                    window.emit("log", serde_json::json!({
                        "level": "WARN",
                        "message": format!("Failed to get metadata for {}: {}", signal_path, e)
                    })).ok();
                }
            }
        }
        
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": format!("Loaded metadata for {} signals", self.signal_metadata_cache.len())
        })).ok();
        
        // Track daily P&L
        let mut last_portfolio_value = initial_capital;
        let mut current_date = candles.first().map(|c| c.time.date_naive()).unwrap_or(chrono::NaiveDate::from_ymd_opt(2024, 1, 1).unwrap());
        
        // Process candles chronologically
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": "Processing candles chronologically..."
        })).ok();
        
        for (candle_idx, candle) in candles.iter().enumerate() {
            // Check for cancellation
            if let Some(ref token) = cancel_token {
                if token.load(Ordering::Relaxed) {
                    window.emit("log", serde_json::json!({
                        "level": "WARN",
                        "message": "Backtest cancelled by user"
                    })).ok();
                    break;
                }
            }
            
            // Update portfolio date
            portfolio.current_date = candle.time;
            
            // Check for new day
            if candle.time.date_naive() != current_date {
                // Calculate daily return
                let daily_return = (portfolio.total_value - last_portfolio_value) / last_portfolio_value;
                daily_returns.push((Utc.with_ymd_and_hms(current_date.year(), current_date.month(), current_date.day(), 0, 0, 0).unwrap(), daily_return));
                
                // Reset for new day
                portfolio.daily_pnl = Decimal::ZERO;
                last_portfolio_value = portfolio.total_value;
                current_date = candle.time.date_naive();
            }
            
            // Build current prices map
            let mut current_prices = HashMap::new();
            let symbol = match &data_source {
                DataSource::Live { symbol, .. } => symbol.clone(),
                DataSource::Parquet { .. } => "EURUSD".to_string(), // Default for parquet
            };
            current_prices.insert(symbol, candle.close);
            
            // Check for position exits (stop loss, take profit, signals)
            // For now, we'll use mock exit signals - in real implementation, 
            // we'd check if any signals occur at this timestamp
            let exit_signals: Vec<SignalEvent> = all_signals.iter()
                .filter(|s| {
                    // Check if signal is within this candle's time window
                    (*s).timestamp >= candle.time - chrono::Duration::hours(1) &&
                    (*s).timestamp < candle.time
                })
                .cloned()
                .collect();
            
            let new_trades = self.check_position_exits(
                candle,
                &mut portfolio,
                &mut position_tracker,
                &exit_signals,
                window
            );
            
            for trade in new_trades {
                completed_trades.push(trade);
            }
            
            // Update portfolio value
            portfolio.update_value(&current_prices);
            
            // Check risk limits
            if let Err(risk_error) = risk_manager.check_risk_limits(&portfolio) {
                window.emit("log", serde_json::json!({
                    "level": "WARN",
                    "message": format!("Risk limit hit at {}: {}", candle.time.format("%Y-%m-%d"), risk_error)
                })).ok();
                break; // Stop trading if risk limits are hit
            }
            
            // Execute components for this candle
            let (signals_at_candle, indicator_values) = match self.execute_components_for_candle(
                &candles,
                candle_idx,
                &data_source,
                window
            ).await {
                Ok((signals, indicators)) => (signals, indicators),
                Err(e) => {
                    window.emit("log", serde_json::json!({
                        "level": "ERROR",
                        "message": format!("Component execution failed at candle {}: {}", candle_idx, e)
                    })).ok();
                    (Vec::new(), HashMap::new())
                }
            };
            
            // Store indicator values for this candle
            for (name, value) in indicator_values {
                // Initialize vector if needed
                if !all_indicator_data.contains_key(&name) {
                    all_indicator_data.insert(name.clone(), vec![None; candles.len()]);
                }
                
                // Store the value at the current candle index
                if let Some(indicator_vec) = all_indicator_data.get_mut(&name) {
                    indicator_vec[candle_idx] = Some(value);
                }
            }
            
            // Add to all signals
            for signal in &signals_at_candle {
                all_signals.push(signal.clone());
            }
            
            // Evaluate entry conditions
            let order_decisions = self.evaluate_entry_conditions(
                &signals_at_candle,
                &position_tracker,
                &data_source,
            );
            
            // Process order decisions
            for decision in order_decisions {
                match self.calculate_position_size(&decision, &portfolio, candle.close, &risk_manager) {
                    Ok(quantity) => {
                        let order = self.create_order_from_decision(
                            &decision,
                            quantity,
                            candle.close,
                            &risk_manager
                        );
                        
                        match self.execute_order_simulated(
                            &order,
                            candle.close,
                            &mut portfolio,
                            &mut position_tracker,
                            window
                        ) {
                            Ok(_) => {
                                executed_orders.push(order);
                            }
                            Err(e) => {
                                window.emit("log", serde_json::json!({
                                    "level": "ERROR",
                                    "message": format!("Execution failed: {}", e)
                                })).ok();
                            }
                        }
                    }
                    Err(e) => {
                        window.emit("log", serde_json::json!({
                            "level": "WARN",
                            "message": format!("Position sizing failed: {}", e)
                        })).ok();
                    }
                }
            }
        }
        
        // Add final day's return
        if !daily_returns.is_empty() {
            let daily_return = (portfolio.total_value - last_portfolio_value) / last_portfolio_value;
            daily_returns.push((Utc.with_ymd_and_hms(current_date.year(), current_date.month(), current_date.day(), 0, 0, 0).unwrap(), daily_return));
        }
        
        // Close any remaining positions at end of backtest
        if !position_tracker.positions.is_empty() {
            window.emit("log", serde_json::json!({
                "level": "INFO",
                "message": "Closing remaining positions at end of backtest..."
            })).ok();
            
            if let Some(last_candle) = candles.last() {
                let final_trades = self.check_position_exits(
                    last_candle,
                    &mut portfolio,
                    &mut position_tracker,
                    &[],
                    window
                );
                
                for trade in final_trades {
                    completed_trades.push(trade);
                }
            }
        }
        
        // Calculate final metrics
        let winning_trades = completed_trades.iter().filter(|t| t.pnl > Decimal::ZERO).count() as i32;
        let losing_trades = completed_trades.iter().filter(|t| t.pnl < Decimal::ZERO).count() as i32;
        let total_pnl = portfolio.total_value - portfolio.initial_capital;
        let sharpe_ratio = Self::calculate_sharpe_ratio(&daily_returns);
        
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": format!("Backtest complete: {} trades, {} wins, {} losses", 
                completed_trades.len(), winning_trades, losing_trades)
        })).ok();
        
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": format!("Final P&L: {} ({:.2}%), Sharpe: {:.2}", 
                total_pnl, 
                (total_pnl / initial_capital) * Decimal::from(100),
                sharpe_ratio)
        })).ok();
        
        // Shutdown component executor
        if let Err(e) = shutdown_component_executor() {
            window.emit("log", serde_json::json!({
                "level": "WARN",
                "message": format!("Failed to shutdown component executor cleanly: {}", e)
            })).ok();
        }
        
        Ok(BacktestResult {
            total_trades: completed_trades.len() as i32,
            winning_trades,
            losing_trades,
            total_pnl,
            max_drawdown: portfolio.max_drawdown,
            sharpe_ratio,
            start_capital: initial_capital,
            end_capital: portfolio.total_value,
            signals_generated: all_signals,
            order_decisions: Vec::new(), // Not tracking separately in chronological mode
            executed_orders,
            completed_trades,
            final_portfolio: portfolio,
            daily_returns,
            indicator_data: all_indicator_data,
        })
    }
    
    /// Parse signal output from component stdout
    fn parse_signal_output(&self, output: &str, signal_name: &str) -> Vec<SignalEvent> {
        let mut signals = Vec::new();
        
        // Look for SIGNAL_START and SIGNAL_END markers
        if let Some(start_idx) = output.find("SIGNAL_START") {
            if let Some(end_idx) = output.find("SIGNAL_END") {
                let signal_json = &output[start_idx + 12..end_idx].trim();
                
                // Parse JSON array of signals
                match serde_json::from_str::<Vec<serde_json::Value>>(signal_json) {
                    Ok(signal_array) => {
                        for signal_data in signal_array {
                            if let Ok(signal_event) = self.parse_signal_event(signal_data, signal_name) {
                                signals.push(signal_event);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to parse signal JSON: {}", e);
                    }
                }
            }
        }
        
        signals
    }
    
    /// Parse individual signal event from JSON
    fn parse_signal_event(&self, data: serde_json::Value, signal_name: &str) -> Result<SignalEvent, String> {
        let timestamp = data.get("timestamp")
            .and_then(|v| v.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .ok_or("Missing or invalid timestamp")?;
            
        let signal_type = data.get("signal_type")
            .or_else(|| data.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
            
        let strength = data.get("strength")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
            
        let mut metadata = HashMap::new();
        if let Some(meta) = data.get("metadata").and_then(|v| v.as_object()) {
            for (key, value) in meta {
                metadata.insert(key.clone(), value.clone());
            }
        }
        
        Ok(SignalEvent {
            timestamp,
            signal_name: signal_name.to_string(),
            signal_type,
            strength,
            metadata,
        })
    }
    
    /// Evaluate entry conditions against signals
    fn evaluate_entry_conditions(
        &self,
        signals: &[SignalEvent],
        position_tracker: &PositionTracker,
        data_source: &DataSource,
    ) -> Vec<OrderDecision> {
        let mut decisions = Vec::new();
        
        // Check if we can open new positions
        let open_positions = position_tracker.positions.len();
        let max_positions = self.strategy_config.parameters
            .get("max_positions")
            .and_then(|v| v.as_i64())
            .unwrap_or(1) as usize;
            
        if open_positions >= max_positions {
            return decisions; // No new entries allowed
        }
        
        // Parse entry conditions
        if let serde_yaml::Value::Mapping(entry_map) = &self.strategy_config.entry {
            if let Some(when_value) = entry_map.get(&serde_yaml::Value::String("when".to_string())) {
                if let serde_yaml::Value::Sequence(when_conditions) = when_value {
                for condition in when_conditions {
                    if let serde_yaml::Value::Mapping(condition_map) = condition {
                        let signal_name = condition_map.get(&serde_yaml::Value::String("signal".to_string()))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                            
                        if let Some(outputs_value) = condition_map.get(&serde_yaml::Value::String("outputs".to_string())) {
                            if let serde_yaml::Value::Mapping(outputs) = outputs_value {
                                // Convert serde_yaml outputs to serde_json for matching
                                let outputs_json: serde_json::Map<String, serde_json::Value> = outputs.iter()
                                    .filter_map(|(k, v)| {
                                        if let serde_yaml::Value::String(key_str) = k {
                                            let json_value = serde_json::to_value(v).unwrap_or(serde_json::Value::Null);
                                            Some((key_str.clone(), json_value))
                                        } else {
                                            None
                                        }
                                    })
                                    .collect();
                                    
                                // Check each signal against the condition
                                for signal in signals {
                                    if signal.signal_name.contains(signal_name) {
                                        if self.signal_matches_outputs(signal, &outputs_json) {
                                            // Generate order decision
                                            let action = entry_map.get(&serde_yaml::Value::String("action".to_string()))
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("buy");
                                                
                                            let size = entry_map.get(&serde_yaml::Value::String("size".to_string()))
                                                .and_then(|v| v.as_str())
                                                .and_then(|s| {
                                                    if s.starts_with("parameters.") {
                                                        let param_name = &s[11..];
                                                        self.strategy_config.parameters
                                                            .get(param_name)
                                                            .and_then(|v| v.as_f64())
                                                    } else {
                                                        s.parse().ok()
                                                    }
                                                })
                                                .unwrap_or(0.01); // Default 1%
                                                
                                            let decision = OrderDecision {
                                                timestamp: signal.timestamp,
                                                action: match action {
                                                    "buy" => OrderAction::Buy,
                                                    "sell" => OrderAction::Sell,
                                                    _ => OrderAction::Buy,
                                                },
                                                symbol: match data_source {
                                                    DataSource::Live { symbol, .. } => symbol.clone(),
                                                    DataSource::Parquet { .. } => "EURUSD".to_string(), // Default for parquet
                                                },
                                                reason: format!("Entry signal: {}", signal.signal_type),
                                                triggering_signal: signal.clone(),
                                                size_percentage: size,
                                            };
                                            
                                            decisions.push(decision);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            }
        }
        
        decisions
    }
    
    /// Check if signal matches output conditions
    fn signal_matches_outputs(&self, signal: &SignalEvent, outputs: &serde_json::Map<String, Value>) -> bool {
        for (key, expected_value) in outputs {
            let actual_value = match key.as_str() {
                "crossover_type" => Some(Value::String(signal.signal_type.clone())),
                "signal_strength" => {
                    if let Some(num) = serde_json::Number::from_f64(signal.strength) {
                        Some(Value::Number(num))
                    } else {
                        None
                    }
                },
                _ => signal.metadata.get(key).cloned(),
            };
            
            if let Some(actual) = actual_value {
                if !self.value_matches_condition(&actual, expected_value) {
                    return false;
                }
            } else {
                return false;
            }
        }
        
        true
    }
    
    /// Check if a value matches a condition (supports comparisons)
    fn value_matches_condition(&self, actual: &Value, expected: &Value) -> bool {
        match expected {
            Value::String(s) => {
                if s.starts_with('>') || s.starts_with('<') || s.starts_with('=') {
                    // Parse comparison
                    self.evaluate_comparison(actual, s)
                } else {
                    // Direct string match
                    actual == expected
                }
            }
            _ => actual == expected,
        }
    }
    
    /// Evaluate comparison expressions like "> 0.1"
    fn evaluate_comparison(&self, actual: &Value, comparison: &str) -> bool {
        if let Some(actual_num) = actual.as_f64() {
            let comparison = comparison.trim();
            
            if let Some(threshold_str) = comparison.strip_prefix('>') {
                if let Ok(threshold) = threshold_str.trim().parse::<f64>() {
                    return actual_num > threshold;
                }
            } else if let Some(threshold_str) = comparison.strip_prefix('<') {
                if let Ok(threshold) = threshold_str.trim().parse::<f64>() {
                    return actual_num < threshold;
                }
            } else if let Some(threshold_str) = comparison.strip_prefix(">=") {
                if let Ok(threshold) = threshold_str.trim().parse::<f64>() {
                    return actual_num >= threshold;
                }
            } else if let Some(threshold_str) = comparison.strip_prefix("<=") {
                if let Ok(threshold) = threshold_str.trim().parse::<f64>() {
                    return actual_num <= threshold;
                }
            }
        }
        
        false
    }
    
    /// Calculate position size based on risk parameters
    fn calculate_position_size(
        &self,
        decision: &OrderDecision,
        portfolio: &Portfolio,
        current_price: Decimal,
        risk_manager: &RiskManager,
    ) -> Result<Decimal, String> {
        // Get base position size from decision (as percentage)
        let position_size_pct = Decimal::from_f64(decision.size_percentage)
            .ok_or("Invalid position size percentage")?;
        
        // Calculate position value
        let position_value = portfolio.total_value * position_size_pct;
        
        // Check position size limit
        let max_position_value = portfolio.total_value * risk_manager.position_size_limit;
        let final_position_value = position_value.min(max_position_value);
        
        // Calculate quantity based on current price
        let quantity = final_position_value / current_price;
        
        // For forex, round to reasonable lot size (0.01 lots)
        let rounded_quantity = (quantity * Decimal::from(100)).round() / Decimal::from(100);
        
        if rounded_quantity <= Decimal::ZERO {
            return Err("Position size too small".to_string());
        }
        
        Ok(rounded_quantity)
    }
    
    /// Convert OrderDecision to Order with proper sizing
    fn create_order_from_decision(
        &self,
        decision: &OrderDecision,
        quantity: Decimal,
        current_price: Decimal,
        risk_manager: &RiskManager,
    ) -> crate::orders::Order {
        use crate::orders::{Order, OrderSide, OrderType};
        
        let side = match decision.action {
            OrderAction::Buy => OrderSide::Buy,
            OrderAction::Sell => OrderSide::Sell,
            _ => OrderSide::Buy, // Default for close actions
        };
        
        let mut order = Order::new(
            decision.symbol.clone(),
            side.clone(),
            quantity,
            OrderType::Market,
            "orchestrator".to_string(),
        );
        
        // Set metadata
        order.strategy_id = Some(self.strategy_config.name.clone());
        order.signal_id = Some(decision.triggering_signal.signal_name.clone());
        
        // Add metadata
        order.metadata.insert(
            "signal_type".to_string(),
            serde_json::Value::String(decision.triggering_signal.signal_type.clone())
        );
        order.metadata.insert(
            "signal_strength".to_string(),
            serde_json::Value::Number(
                serde_json::Number::from_f64(decision.triggering_signal.strength).unwrap()
            )
        );
        order.metadata.insert(
            "entry_price".to_string(),
            serde_json::Value::String(current_price.to_string())
        );
        
        // Calculate stop loss and take profit prices
        let (stop_loss, take_profit) = match side {
            OrderSide::Buy => {
                let sl = current_price * (Decimal::ONE - risk_manager.stop_loss_percent);
                let tp = current_price * (Decimal::ONE + risk_manager.take_profit_percent);
                (sl, tp)
            }
            OrderSide::Sell => {
                let sl = current_price * (Decimal::ONE + risk_manager.stop_loss_percent);
                let tp = current_price * (Decimal::ONE - risk_manager.take_profit_percent);
                (sl, tp)
            }
        };
        
        order.metadata.insert(
            "stop_loss".to_string(),
            serde_json::Value::String(stop_loss.to_string())
        );
        order.metadata.insert(
            "take_profit".to_string(),
            serde_json::Value::String(take_profit.to_string())
        );
        
        order
    }
    
    /// Simulate order execution for backtesting
    fn execute_order_simulated(
        &self,
        order: &crate::orders::Order,
        current_price: Decimal,
        portfolio: &mut Portfolio,
        position_tracker: &mut PositionTracker,
        window: &Window,
    ) -> Result<Position, String> {
        use crate::orders::OrderSide;
        
        // Apply slippage (optional)
        let slippage = Decimal::from_str("0.0001").unwrap(); // 0.01% slippage
        let execution_price = match order.side {
            OrderSide::Buy => current_price * (Decimal::ONE + slippage),
            OrderSide::Sell => current_price * (Decimal::ONE - slippage),
        };
        
        // Calculate cost
        let cost = order.quantity * execution_price;
        
        // Check if we have enough cash
        if cost > portfolio.cash {
            return Err("Insufficient funds".to_string());
        }
        
        // Update portfolio
        portfolio.cash -= cost;
        
        // Create position
        let position = Position {
            id: Uuid::new_v4().to_string(),
            symbol: order.symbol.clone(),
            side: match order.side {
                OrderSide::Buy => PositionSide::Long,
                OrderSide::Sell => PositionSide::Short,
            },
            entry_price: execution_price,
            size: order.quantity,
            entry_time: portfolio.current_date,
            triggering_signal: order.signal_id.clone().unwrap_or_default(),
            stop_loss: order.metadata.get("stop_loss")
                .and_then(|v| v.as_str())
                .and_then(|s| Decimal::from_str(s).ok()),
            take_profit: order.metadata.get("take_profit")
                .and_then(|v| v.as_str())
                .and_then(|s| Decimal::from_str(s).ok()),
        };
        
        // Add to position tracker
        position_tracker.positions.insert(position.id.clone(), position.clone());
        portfolio.positions.insert(position.symbol.clone(), position.clone());
        
        // Log execution
        window.emit("log", serde_json::json!({
            "level": "TRADE",
            "message": format!("Executed {:?} {} {} @ {} (slippage: {})",
                order.side,
                order.quantity,
                order.symbol,
                execution_price,
                execution_price - current_price
            )
        })).ok();
        
        Ok(position)
    }
    
    /// Load candle data for backtesting
    async fn load_candles(
        &self,
        data_source: &DataSource,
        window: &Window,
    ) -> Result<Vec<Candle>, String> {
        match data_source {
            DataSource::Live { symbol, timeframe, from, to } => {
                window.emit("log", serde_json::json!({
                    "level": "INFO",
                    "message": format!("Loading {} {} candles from {} to {}", 
                        symbol, timeframe, from.format("%Y-%m-%d"), to.format("%Y-%m-%d"))
                })).ok();
                
                // Use the existing fetch_candles function that handles cache/database intelligently
                let request = crate::DataRequest {
                    symbol: symbol.clone(),
                    timeframe: timeframe.clone(),
                    from: from.timestamp(),
                    to: to.timestamp(),
                };
                
                // Call fetch_candles through tauri command invocation
                let state = window.state::<crate::AppState>();
                let candles = crate::fetch_candles(request, state, window.clone()).await
                    .map_err(|e| format!("Failed to fetch candles: {}", e))?;
                
                // Convert main::Candle to orchestrator::Candle
                let orchestrator_candles: Vec<Candle> = candles.into_iter()
                    .map(|c| Candle {
                        time: DateTime::from_timestamp(c.time, 0)
                            .unwrap_or_else(|| Utc::now())
                            .with_timezone(&Utc),
                        open: Decimal::from_f64(c.open).unwrap_or(Decimal::ZERO),
                        high: Decimal::from_f64(c.high).unwrap_or(Decimal::ZERO),
                        low: Decimal::from_f64(c.low).unwrap_or(Decimal::ZERO),
                        close: Decimal::from_f64(c.close).unwrap_or(Decimal::ZERO),
                        volume: c.volume,
                    })
                    .collect();
                
                window.emit("log", serde_json::json!({
                    "level": "INFO",
                    "message": format!("Loaded {} candles from database/cache", orchestrator_candles.len())
                })).ok();
                
                Ok(orchestrator_candles)
            }
            DataSource::Parquet { filename } => {
                window.emit("log", serde_json::json!({
                    "level": "INFO",
                    "message": format!("Loading candles from parquet file: {}", filename)
                })).ok();
                
                // TODO: Implement parquet loading if needed
                // For now, return empty vec
                Ok(Vec::new())
            }
        }
    }
    
    /// Generate mock candles for testing
    fn generate_mock_candles(
        &self,
        symbol: &str,
        from: &DateTime<Utc>,
        to: &DateTime<Utc>,
    ) -> Vec<Candle> {
        let mut candles = Vec::new();
        let mut current_time = from.clone();
        let mut price = Decimal::from_str("1.0850").unwrap();
        
        while current_time <= *to {
            // Skip weekends for forex
            if current_time.weekday() != chrono::Weekday::Sat && 
               current_time.weekday() != chrono::Weekday::Sun {
                // Generate some price movement
                let change = Decimal::from_f64(
                    (rand::random::<f64>() - 0.5) * 0.001
                ).unwrap_or(Decimal::ZERO);
                price += change;
                
                let high = price + Decimal::from_str("0.0002").unwrap();
                let low = price - Decimal::from_str("0.0002").unwrap();
                
                candles.push(Candle {
                    time: current_time,
                    open: price,
                    high,
                    low,
                    close: price,
                    volume: 1000,
                });
            }
            
            current_time = current_time + chrono::Duration::hours(1);
        }
        
        candles
    }
    
    /// Check positions for exit conditions
    fn check_position_exits(
        &self,
        candle: &Candle,
        portfolio: &mut Portfolio,
        position_tracker: &mut PositionTracker,
        exit_signals: &[SignalEvent],
        window: &Window,
    ) -> Vec<Trade> {
        let mut completed_trades = Vec::new();
        let mut positions_to_close = Vec::new();
        
        // Check each open position
        for (position_id, position) in &position_tracker.positions {
            let mut should_close = false;
            let mut exit_reason = String::new();
            let mut exit_price = candle.close;
            
            // Check stop loss
            if let Some(stop_loss) = position.stop_loss {
                match position.side {
                    PositionSide::Long => {
                        if candle.low <= stop_loss {
                            should_close = true;
                            exit_reason = "Stop Loss".to_string();
                            exit_price = stop_loss;
                        }
                    }
                    PositionSide::Short => {
                        if candle.high >= stop_loss {
                            should_close = true;
                            exit_reason = "Stop Loss".to_string();
                            exit_price = stop_loss;
                        }
                    }
                }
            }
            
            // Check take profit
            if !should_close {
                if let Some(take_profit) = position.take_profit {
                    match position.side {
                        PositionSide::Long => {
                            if candle.high >= take_profit {
                                should_close = true;
                                exit_reason = "Take Profit".to_string();
                                exit_price = take_profit;
                            }
                        }
                        PositionSide::Short => {
                            if candle.low <= take_profit {
                                should_close = true;
                                exit_reason = "Take Profit".to_string();
                                exit_price = take_profit;
                            }
                        }
                    }
                }
            }
            
            // Check exit signals
            if !should_close {
                for signal in exit_signals {
                    if signal.signal_type == "death_cross" && 
                       matches!(position.side, PositionSide::Long) {
                        should_close = true;
                        exit_reason = format!("Exit Signal: {}", signal.signal_type);
                        exit_price = candle.close;
                        break;
                    } else if signal.signal_type == "golden_cross" && 
                              matches!(position.side, PositionSide::Short) {
                        should_close = true;
                        exit_reason = format!("Exit Signal: {}", signal.signal_type);
                        exit_price = candle.close;
                        break;
                    }
                }
            }
            
            if should_close {
                positions_to_close.push((position_id.clone(), exit_price, exit_reason));
            }
        }
        
        // Close positions and create trades
        for (position_id, exit_price, exit_reason) in positions_to_close {
            if let Some(position) = position_tracker.positions.remove(&position_id) {
                // Calculate P&L
                let pnl = match position.side {
                    PositionSide::Long => (exit_price - position.entry_price) * position.size,
                    PositionSide::Short => (position.entry_price - exit_price) * position.size,
                };
                
                let pnl_percent = pnl / (position.entry_price * position.size);
                let holding_period = candle.time.signed_duration_since(position.entry_time);
                
                // Update portfolio
                portfolio.cash += position.size * exit_price;
                portfolio.positions.remove(&position.symbol);
                
                // Create trade record
                let trade = Trade {
                    id: position.id.clone(),
                    symbol: position.symbol.clone(),
                    side: position.side.clone(),
                    entry_time: position.entry_time,
                    entry_price: position.entry_price,
                    exit_time: candle.time,
                    exit_price,
                    quantity: position.size,
                    pnl,
                    pnl_percent,
                    exit_reason: exit_reason.clone(),
                    holding_period_hours: holding_period.num_hours() as f64,
                };
                
                // Log the trade
                window.emit("log", serde_json::json!({
                    "level": "TRADE",
                    "message": format!("Closed {} {} @ {} - {} (P&L: {} / {:.2}%)",
                        position.symbol,
                        position.size,
                        exit_price,
                        exit_reason,
                        pnl,
                        pnl_percent * Decimal::from(100)
                    )
                })).ok();
                
                completed_trades.push(trade);
                position_tracker.closed_positions.push(position);
            }
        }
        
        completed_trades
    }
    
    /// Execute components for a specific candle and return signals and indicator data
    async fn execute_components_for_candle(
        &self,
        candles: &[Candle],
        candle_idx: usize,
        data_source: &DataSource,
        window: &Window,
    ) -> Result<(Vec<SignalEvent>, HashMap<String, f64>), String> {
        let mut all_signals = Vec::new();
        let mut current_indicator_values: HashMap<String, f64> = HashMap::new();
        
        // Get symbol and timeframe from data source
        let (symbol, timeframe) = match data_source {
            DataSource::Live { symbol, timeframe, .. } => (symbol.clone(), timeframe.clone()),
            DataSource::Parquet { .. } => ("EURUSD".to_string(), "1h".to_string()),
        };
        
        // Set up base environment variables
        let mut base_env = HashMap::new();
        base_env.insert("SYMBOL".to_string(), symbol.clone());
        base_env.insert("TIMEFRAME".to_string(), timeframe.clone());
        
        // Process each signal
        for signal_path in &self.strategy_config.dependencies.signals {
            window.emit("log", serde_json::json!({
                "level": "DEBUG",
                "message": format!("Processing signal: {} for candle {}", signal_path, candle_idx)
            })).ok();
            
            let signal_file_path = Self::convert_module_path_to_file_path(signal_path);
            
            // Get signal metadata from cache
            let metadata = match self.signal_metadata_cache.get(&signal_file_path) {
                Some(meta) => meta.clone(),
                None => {
                    window.emit("log", serde_json::json!({
                        "level": "WARN",
                        "message": format!("No metadata cached for {}", signal_path)
                    })).ok();
                    continue;
                }
            };
            
            // Extract lookback requirement from metadata
            let lookback_required = metadata.get("lookback_required")
                .and_then(|v| v.as_u64())
                .unwrap_or(200) as usize; // Default to 200 candles if not specified
            
            // Extract required indicators from metadata
            let mut indicator_outputs: HashMap<String, HashMap<String, Vec<f64>>> = HashMap::new();
            
            if let Some(required_indicators) = metadata.get("required_indicators").and_then(|v| v.as_array()) {
                for indicator_spec in required_indicators {
                    let name = indicator_spec.get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    
                    let indicator_type = indicator_spec.get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("sma");
                    
                    let params = indicator_spec.get("params")
                        .and_then(|v| v.as_object())
                        .cloned()
                        .unwrap_or_default();
                    
                    // For indicators, use their period parameter as lookback if available
                    // Otherwise use the signal's lookback requirement
                    let indicator_lookback = params.get("period")
                        .and_then(|v| v.as_u64())
                        .map(|p| (p * 2) as usize)  // Use 2x period for warmup
                        .unwrap_or(lookback_required);
                    
                    window.emit("log", serde_json::json!({
                        "level": "DEBUG",
                        "message": format!("Running required indicator '{}' (type: {}) for signal", name, indicator_type)
                    })).ok();
                    
                    // Build indicator path (e.g., "sma" -> "core.indicators.trend.sma")
                    let indicator_path = self.resolve_indicator_path(indicator_type);
                    let indicator_file_path = Self::convert_module_path_to_file_path(&indicator_path);
                    
                    // Set up environment with parameters
                    let mut indicator_env = base_env.clone();
                    for (key, value) in &params {
                        indicator_env.insert(
                            format!("PARAMS_{}", key.to_uppercase()),
                            value.to_string()
                        );
                    }
                    
                    // Run the indicator
                    match run_component_for_candle(
                        "indicator",
                        &indicator_file_path,
                        candles,
                        candle_idx,
                        indicator_env,
                        window,
                        indicator_lookback,
                    ).await {
                        Ok(output) => {
                            if let Some(values) = output.indicator_values {
                                indicator_outputs.insert(name.to_string(), values);
                            }
                        }
                        Err(e) => {
                            window.emit("log", serde_json::json!({
                                "level": "WARN",
                                "message": format!("Required indicator '{}' failed: {}", name, e)
                            })).ok();
                        }
                    }
                }
            }
            
            // Now run the signal with its required indicators
            let mut signal_env = base_env.clone();
            
            // Convert indicator outputs to the format expected by the signal
            let mut flattened_indicators: HashMap<String, Vec<f64>> = HashMap::new();
            for (name, values_map) in &indicator_outputs {
                if let Some(values) = values_map.get("default") {
                    flattened_indicators.insert(name.clone(), values.clone());
                    
                    // Store the current value (last in the array) for this candle
                    if let Some(last_value) = values.last() {
                        current_indicator_values.insert(name.clone(), *last_value);
                    }
                }
            }
            
            // Pass indicators via environment (temporary until we improve the protocol)
            for (name, values) in &flattened_indicators {
                signal_env.insert(
                    format!("INDICATOR_{}", name.to_uppercase()),
                    serde_json::to_string(values).unwrap_or_default()
                );
            }
            
            window.emit("log", serde_json::json!({
                "level": "DEBUG",
                "message": format!("Running signal {} with {} indicators", signal_path, flattened_indicators.len())
            })).ok();
            
            match run_component_for_candle(
                "signal",
                &signal_file_path,
                candles,
                candle_idx,
                signal_env,
                window,
                lookback_required,
            ).await {
                Ok(output) => {
                    // Use the new signal data if available
                    if let Some(signal_data) = output.signal_data {
                        let signal_event = SignalEvent {
                            timestamp: candles[candle_idx].time,
                            signal_name: signal_path.clone(),
                            signal_type: signal_data.signal_type,
                            strength: signal_data.strength,
                            metadata: signal_data.metadata,
                        };
                        all_signals.push(signal_event);
                    }
                }
                Err(e) => {
                    window.emit("log", serde_json::json!({
                        "level": "WARN",
                        "message": format!("Signal {} failed: {}", signal_path, e)
                    })).ok();
                }
            }
        }
        
        window.emit("log", serde_json::json!({
            "level": "DEBUG",
            "message": format!("Generated {} signals at candle {}", all_signals.len(), candle_idx)
        })).ok();
        
        Ok((all_signals, current_indicator_values))
    }
    
    /// Get signal metadata from the component server
    async fn get_signal_metadata(
        &self,
        signal_path: &str,
        window: &Window,
    ) -> Result<serde_json::Value, String> {
        window.emit("log", serde_json::json!({
            "level": "DEBUG",
            "message": format!("Getting metadata for signal: {}", signal_path)
        })).ok();
        
        // Use the component runner to get metadata
        let mut executor_guard = component_runner::COMPONENT_EXECUTOR.lock()
            .map_err(|e| format!("Failed to lock component executor: {}", e))?;
        
        let executor = executor_guard.as_mut()
            .ok_or("Component executor not initialized")?;
        
        let result = executor.get_component_metadata("signal", signal_path);
        
        window.emit("log", serde_json::json!({
            "level": "DEBUG", 
            "message": format!("Metadata result: {:?}", result)
        })).ok();
        
        result
    }
    
    /// Resolve indicator type to full module path
    fn resolve_indicator_path(&self, indicator_type: &str) -> String {
        // Map common indicator types to their module paths
        match indicator_type {
            "sma" => "core.indicators.trend.sma".to_string(),
            "ema" => "core.indicators.trend.ema".to_string(),
            "rsi" => "core.indicators.momentum.rsi".to_string(),
            "macd" => "core.indicators.momentum.macd".to_string(),
            "bb" => "core.indicators.volatility.bb".to_string(),
            // Add more mappings as needed
            _ => format!("core.indicators.{}", indicator_type),
        }
    }
    
    /// Calculate Sharpe ratio from daily returns
    fn calculate_sharpe_ratio(daily_returns: &[(DateTime<Utc>, Decimal)]) -> f64 {
        if daily_returns.len() < 2 {
            return 0.0;
        }
        
        let returns: Vec<f64> = daily_returns
            .iter()
            .map(|(_, r)| r.to_f64().unwrap_or(0.0))
            .collect();
        
        let mean = returns.iter().sum::<f64>() / returns.len() as f64;
        let variance = returns
            .iter()
            .map(|r| (r - mean).powi(2))
            .sum::<f64>() / returns.len() as f64;
        let std_dev = variance.sqrt();
        
        if std_dev == 0.0 {
            return 0.0;
        }
        
        // Annualized Sharpe ratio (assuming 252 trading days)
        (mean * 252.0f64.sqrt()) / std_dev
    }
    
    /// Run the orchestrator in live mode
    pub async fn run_live_mode(
        &self,
        redis_url: &str,
        initial_capital: Decimal,
        window: &Window,
    ) -> Result<(), String> {
        // Initialize component executor
        initialize_component_executor()
            .map_err(|e| format!("Failed to initialize component executor: {}", e))?;
        
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": "Starting orchestrator in LIVE mode..."
        })).ok();
        
        // Connect to Redis
        let redis_client = RedisClient::open(redis_url)
            .map_err(|e| format!("Failed to connect to Redis: {}", e))?;
        
        let mut conn = redis_client.get_async_connection().await
            .map_err(|e| format!("Failed to get Redis connection: {}", e))?;
        
        // Create consumer group for signals if it doesn't exist
        let _: Result<(), _> = conn
            .xgroup_create_mkstream("signals:live", "orchestrator_group", "$")
            .await;
        
        // Initialize portfolio and managers
        let mut portfolio = Portfolio::new(initial_capital);
        let risk_manager = RiskManager::from_strategy_config(&self.strategy_config);
        let mut position_tracker = PositionTracker::default();
        let mut executed_orders = Vec::new();
        let mut _completed_trades: Vec<Trade> = Vec::new();
        
        // Get execution engine connection (for later)
        // let execution_engine = ExecutionEngine::new(redis_url)?;
        
        window.emit("log", serde_json::json!({
            "level": "SUCCESS",
            "message": "Connected to Redis signal stream. Waiting for signals..."
        })).ok();
        
        // Main live trading loop
        loop {
            // Read from signal stream with timeout
            let opts = StreamReadOptions::default()
                .count(10)  // Process up to 10 signals at a time
                .block(1000)  // 1 second timeout
                .group("orchestrator_group", "orchestrator-1");
            
            let result: Result<StreamReadReply, _> = conn
                .xread_options(&["signals:live"], &[">"], &opts)
                .await;
            
            match result {
                Ok(reply) => {
                    for stream_key in reply.keys {
                        if stream_key.key == "signals:live" {
                            for stream_id in stream_key.ids {
                                // Process each signal
                                if let Some(signal_data) = stream_id.map.get("signal") {
                                    match signal_data {
                                        redis::Value::Data(data) => {
                                            if let Ok(signal_json) = String::from_utf8(data.clone()) {
                                                match self.process_live_signal(
                                                    &signal_json,
                                                    &mut portfolio,
                                                    &risk_manager,
                                                    &mut position_tracker,
                                                    &mut executed_orders,
                                                    window,
                                                ).await {
                                                    Ok(_) => {
                                                        // Acknowledge message
                                                        let _: () = conn
                                                            .xack("signals:live", "orchestrator_group", &[&stream_id.id])
                                                            .await
                                                            .unwrap_or(());
                                                    }
                                                    Err(e) => {
                                                        window.emit("log", serde_json::json!({
                                                            "level": "ERROR",
                                                            "message": format!("Failed to process signal: {}", e)
                                                        })).ok();
                                                    }
                                                }
                                            }
                                        }
                                        _ => {
                                            window.emit("log", serde_json::json!({
                                                "level": "WARN",
                                                "message": "Invalid signal data in stream"
                                            })).ok();
                                        }
                                    }
                                }
                                
                                // Also check for price updates to update portfolio
                                if let Some(price_data) = stream_id.map.get("price_update") {
                                    // Handle real-time price updates for portfolio valuation
                                    self.handle_price_update(&price_data, &mut portfolio, &position_tracker);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    // Only log non-timeout errors
                    if !e.to_string().contains("timeout") {
                        window.emit("log", serde_json::json!({
                            "level": "WARN",
                            "message": format!("Error reading from signal stream: {}", e)
                        })).ok();
                    }
                }
            }
            
            // Periodic portfolio update (every iteration)
            self.emit_portfolio_update(&portfolio, window);
            
            // Check for stop conditions (e.g., emergency stop, daily loss limit)
            if risk_manager.should_stop_trading(&portfolio) {
                window.emit("log", serde_json::json!({
                    "level": "ERROR",
                    "message": "Risk limits exceeded. Stopping live trading."
                })).ok();
                break;
            }
            
            // Small delay to prevent CPU spinning
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        
        // Shutdown component executor
        if let Err(e) = shutdown_component_executor() {
            window.emit("log", serde_json::json!({
                "level": "WARN",
                "message": format!("Failed to shutdown component executor cleanly: {}", e)
            })).ok();
        }
        
        Ok(())
    }
    
    /// Process a live signal from Redis
    async fn process_live_signal(
        &self,
        signal_json: &str,
        portfolio: &mut Portfolio,
        risk_manager: &RiskManager,
        position_tracker: &mut PositionTracker,
        executed_orders: &mut Vec<crate::orders::Order>,
        window: &Window,
    ) -> Result<(), String> {
        // Parse the signal
        let signal: SignalEvent = serde_json::from_str(signal_json)
            .map_err(|e| format!("Failed to parse signal: {}", e))?;
        
        window.emit("log", serde_json::json!({
            "level": "INFO",
            "message": format!("Received signal: {} - {} (strength: {})",
                signal.signal_name,
                signal.signal_type,
                signal.strength
            )
        })).ok();
        
        // Get current market price (from signal metadata or separate price feed)
        let current_price = signal.metadata.get("current_price")
            .and_then(|v| v.as_f64())
            .and_then(|f| Decimal::from_f64(f))
            .unwrap_or(Decimal::from_str("1.0850").unwrap());
        
        // Update current prices for portfolio valuation
        let mut current_prices = HashMap::new();
        let symbol = signal.metadata.get("symbol")
            .and_then(|v| v.as_str())
            .unwrap_or("EURUSD");
        current_prices.insert(symbol.to_string(), current_price);
        portfolio.update_value(&current_prices);
        
        // Check for position exits first
        let exit_signals = vec![signal.clone()];
        let mock_candle = Candle {
            time: signal.timestamp,
            open: current_price,
            high: current_price,
            low: current_price,
            close: current_price,
            volume: 0,
        };
        
        let new_trades = self.check_position_exits(
            &mock_candle,
            portfolio,
            position_tracker,
            &exit_signals,
            window,
        );
        
        // Process any completed trades
        for trade in new_trades {
            window.emit("log", serde_json::json!({
                "level": "TRADE",
                "message": format!("Trade completed: {} P&L: {}", trade.id, trade.pnl)
            })).ok();
        }
        
        // Create a data source for live trading (extract symbol from signal metadata or default)
        let symbol = signal.metadata.get("symbol")
            .and_then(|v| v.as_str())
            .unwrap_or("EURUSD")
            .to_string();
            
        let data_source = DataSource::Live {
            symbol,
            timeframe: "1h".to_string(), // Default timeframe for live trading
            from: Utc::now() - chrono::Duration::hours(24),
            to: Utc::now(),
        };
        
        // Evaluate entry conditions
        let order_decisions = self.evaluate_entry_conditions(
            &[signal],
            position_tracker,
            &data_source,
        );
        
        // Process order decisions
        for decision in order_decisions {
            // Check risk limits
            if !risk_manager.can_open_position(portfolio, &Decimal::from_f64(decision.size_percentage).unwrap_or(Decimal::ZERO)) {
                window.emit("log", serde_json::json!({
                    "level": "WARN",
                    "message": "Order rejected: Risk limits exceeded"
                })).ok();
                continue;
            }
            
            // Calculate position size
            let quantity = self.calculate_position_size(
                &decision,
                portfolio,
                current_price,
                risk_manager,
            )?;
            
            if quantity > Decimal::ZERO {
                // Create order
                let order = self.create_order_from_decision(
                    &decision,
                    quantity,
                    current_price,
                    risk_manager,
                );
                
                window.emit("log", serde_json::json!({
                    "level": "ORDER",
                    "message": format!("Sending order to execution engine: {:?} {} @ Market",
                        order.side,
                        order.quantity,
                    )
                })).ok();
                
                // In live mode, we would send to execution engine here
                // For now, simulate execution
                self.execute_order_simulated(&order, current_price, portfolio, position_tracker, window)?;
                executed_orders.push(order);
            }
        }
        
        Ok(())
    }
    
    /// Handle real-time price updates
    fn handle_price_update(
        &self,
        price_data: &redis::Value,
        portfolio: &mut Portfolio,
        _position_tracker: &PositionTracker,
    ) {
        // Parse price update and update portfolio valuation
        if let redis::Value::Data(data) = price_data {
            if let Ok(price_json) = String::from_utf8(data.clone()) {
                if let Ok(price_update) = serde_json::from_str::<HashMap<String, f64>>(&price_json) {
                    let mut current_prices = HashMap::new();
                    for (symbol, price) in price_update {
                        if let Some(decimal_price) = Decimal::from_f64(price) {
                            current_prices.insert(symbol, decimal_price);
                        }
                    }
                    portfolio.update_value(&current_prices);
                }
            }
        }
    }
    
    /// Emit portfolio update event
    fn emit_portfolio_update(&self, portfolio: &Portfolio, window: &Window) {
        window.emit("portfolio_update", serde_json::json!({
            "cash": portfolio.cash.to_string(),
            "total_value": portfolio.total_value.to_string(),
            "positions": portfolio.positions.len(),
            "daily_pnl": portfolio.daily_pnl.to_string(),
            "total_pnl": portfolio.total_pnl.to_string(),
            "max_drawdown": (portfolio.max_drawdown * Decimal::from(100)).to_string(),
        })).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_load_strategy() {
        // This test would need a test YAML file
        // For now, just verify the structure compiles
        let _ = Orchestrator {
            strategy_config: StrategyConfig {
                name: "test".to_string(),
                version: "1.0.0".to_string(),
                author: "test".to_string(),
                description: "test".to_string(),
                dependencies: Dependencies {
                    indicators: vec![],
                    signals: vec![],
                },
                parameters: HashMap::new(),
                entry: serde_yaml::Value::Null,
                exit: serde_yaml::Value::Null,
                risk: HashMap::new(),
                signal_config: HashMap::new(),
            },
            signal_metadata_cache: HashMap::new(),
        };
    }
}