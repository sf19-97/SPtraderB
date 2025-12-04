use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{atomic::AtomicBool, Arc};
use tokio::sync::RwLock;

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
    pub signals_generated: u32,
    pub daily_returns: Vec<(DateTime<Utc>, Decimal)>,
    pub completed_trades: Vec<Trade>,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum PositionSide {
    Long,
    Short,
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
                let value = match position.side {
                    PositionSide::Long => position.size * price,
                    PositionSide::Short => -(position.size * price),
                };
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
        use rust_decimal::prelude::*;
        use std::str::FromStr;

        let max_drawdown = config
            .risk
            .get("max_drawdown")
            .and_then(|v| v.as_f64())
            .and_then(Decimal::from_f64)
            .unwrap_or(Decimal::from_str("0.15").unwrap());

        let daily_loss_limit = config
            .risk
            .get("daily_loss_limit")
            .and_then(|v| v.as_f64())
            .and_then(Decimal::from_f64)
            .unwrap_or(Decimal::from_str("0.03").unwrap());

        let position_limit = config
            .risk
            .get("position_limit")
            .and_then(|v| v.as_f64())
            .and_then(Decimal::from_f64)
            .unwrap_or(Decimal::from_str("0.05").unwrap());

        let max_positions = config
            .parameters
            .get("max_positions")
            .and_then(|v| v.as_i64())
            .unwrap_or(1) as usize;

        let stop_loss = config
            .parameters
            .get("stop_loss")
            .and_then(|v| v.as_f64())
            .and_then(Decimal::from_f64)
            .unwrap_or(Decimal::from_str("0.02").unwrap());

        let take_profit = config
            .parameters
            .get("take_profit")
            .and_then(|v| v.as_f64())
            .and_then(Decimal::from_f64)
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
            return Err(format!(
                "Max drawdown limit exceeded: {:.2}% > {:.2}%",
                portfolio.max_drawdown * Decimal::from(100),
                self.max_drawdown_limit * Decimal::from(100)
            ));
        }

        // Check daily loss limit
        let daily_loss_pct = -portfolio.daily_pnl / portfolio.initial_capital;
        if daily_loss_pct > self.daily_loss_limit {
            return Err(format!(
                "Daily loss limit exceeded: {:.2}% > {:.2}%",
                daily_loss_pct * Decimal::from(100),
                self.daily_loss_limit * Decimal::from(100)
            ));
        }

        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct BacktestState {
    pub status: String, // running | completed | failed | cancelled
    pub progress: f64,  // 0.0 - 100.0
    pub error: Option<String>,
    pub cancel_flag: Arc<AtomicBool>,
}

pub type BacktestRegistry = Arc<RwLock<HashMap<String, BacktestState>>>;
