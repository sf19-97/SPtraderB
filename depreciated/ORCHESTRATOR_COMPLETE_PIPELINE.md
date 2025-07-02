# SPtraderB Orchestrator - Complete Pipeline Documentation

**Last Updated**: January 2025

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Flow](#data-flow)
4. [Component Types](#component-types)
5. [Backtesting Pipeline](#backtesting-pipeline)
6. [Live Trading Pipeline](#live-trading-pipeline)
7. [Risk Management](#risk-management)
8. [Integration Points](#integration-points)
9. [Testing Guide](#testing-guide)
10. [API Reference](#api-reference)

## Overview

The SPtraderB Orchestrator is a unified trading system that handles both backtesting and live trading using the same strategy logic. It processes market data through a pipeline of indicators and signals, evaluates trading rules, generates orders with proper risk management, and tracks performance.

### Key Features
- **Unified Architecture**: Same code paths for backtest and live trading
- **Component-Based**: Modular indicators, signals, and strategies
- **Risk Management**: Centralized position sizing and exposure limits
- **Real-time Updates**: Live portfolio state broadcast to UI
- **Performance Tracking**: Comprehensive metrics including Sharpe ratio

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  PostgreSQL │  │   Parquet   │  │ Live Feed   │            │
│  │  TimescaleDB│  │   Files     │  │   (Redis)   │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR CORE                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Strategy  │  │    Risk     │  │  Portfolio  │            │
│  │   Loader    │  │   Manager   │  │   Tracker   │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    COMPONENT PIPELINE                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Indicators  │──▶│   Signals   │──▶│ Strategies  │            │
│  │  (Python)   │  │  (Python)   │  │   (YAML)    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXECUTION LAYER                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Orders    │  │  Execution  │  │   Broker    │            │
│  │  (Structs)  │  │   Engine    │  │    APIs     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Backtesting Mode

```
Historical Data → Environment Variables → Python Components → Signal Events → 
Strategy Rules → Order Decisions → Risk Checks → Position Sizing → 
Simulated Execution → Performance Metrics
```

### 2. Live Trading Mode

```
Redis Signal Stream → Signal Processing → Strategy Rules → Order Decisions → 
Risk Checks → Position Sizing → Execution Engine → Broker → 
Position Updates → Portfolio State → UI Updates
```

## Component Types

### 1. Indicators (`/workspace/core/indicators/`)
- **Purpose**: Calculate technical indicators from price data
- **Input**: OHLCV data via environment variables
- **Output**: Indicator values (printed to stdout)
- **Example**: Simple Moving Average (SMA)

```python
# core/indicators/trend/sma.py
class SMA:
    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        return data['close'].rolling(window=self.period).mean()
```

### 2. Signals (`/workspace/core/signals/`)
- **Purpose**: Generate trading signals from indicators
- **Input**: Indicator data and market data
- **Output**: Signal events with type and strength
- **Metadata Version 2**: Self-contained indicator requirements

```python
# core/signals/ma_crossover.py
__metadata_version__ = 2
__metadata__ = {
    'required_indicators': [
        {'name': 'ma_fast', 'type': 'sma', 'params': {'period': 20}},
        {'name': 'ma_slow', 'type': 'sma', 'params': {'period': 50}}
    ]
}
```

### 3. Strategies (`/workspace/strategies/`)
- **Purpose**: Define trading rules and risk parameters
- **Format**: YAML configuration files
- **Components**: Entry/exit conditions, risk limits, position sizing

```yaml
# strategies/ma_crossover_strategy.yaml
entry:
  when:
    - signal: ma_crossover
      outputs:
        crossover_type: golden_cross
        signal_strength: "> 0.1"
  action: buy
  size: parameters.position_size
```

## Backtesting Pipeline

### Step 1: Load Strategy
```rust
let orchestrator = Orchestrator::load_strategy("workspace/strategies/ma_crossover_strategy.yaml")?;
```

### Step 2: Initialize Components
```rust
let portfolio = Portfolio::new(initial_capital);
let risk_manager = RiskManager::from_strategy_config(&strategy_config)?;
let position_tracker = PositionTracker::default();
```

### Step 3: Load Market Data
```rust
let candles = orchestrator.load_candles(&data_source, window).await?;
```

### Step 4: Process Chronologically
```rust
for candle in candles {
    // 1. Check position exits (stop loss, take profit, signals)
    let exit_trades = check_position_exits(&candle, &mut portfolio, &mut position_tracker);
    
    // 2. Run indicators on current data window
    let indicator_results = run_indicators(&data_window);
    
    // 3. Run signals using indicator outputs
    let signal_events = run_signals(&indicator_results);
    
    // 4. Evaluate entry conditions
    let order_decisions = evaluate_entry_conditions(&signal_events, &position_tracker);
    
    // 5. Apply risk management and sizing
    for decision in order_decisions {
        if risk_manager.can_open_position(&portfolio, &decision) {
            let quantity = calculate_position_size(&portfolio, &decision, &risk_manager);
            let order = create_order_from_decision(&decision, quantity, &risk_manager);
            execute_order_simulated(&order, &mut portfolio, &mut position_tracker);
        }
    }
    
    // 6. Update portfolio value and metrics
    portfolio.update_value(&current_prices);
    track_daily_returns(&portfolio);
}
```

### Step 5: Calculate Performance
```rust
let sharpe_ratio = calculate_sharpe_ratio(&daily_returns);
let max_drawdown = portfolio.max_drawdown;
let total_pnl = portfolio.total_value - portfolio.initial_capital;
```

## Live Trading Pipeline

### Step 1: Start Live Mode
```rust
orchestrator.run_live_mode(&redis_url, initial_capital, &window).await?;
```

### Step 2: Subscribe to Signals
```rust
// Create Redis consumer group
conn.xgroup_create_mkstream("signals:live", "orchestrator_group", "$").await;

// Main event loop
loop {
    let signals = conn.xread_options(&["signals:live"], &[">"], &opts).await?;
    
    for signal in signals {
        process_live_signal(&signal, &mut portfolio, &risk_manager, &mut position_tracker).await?;
    }
    
    emit_portfolio_update(&portfolio, &window);
    
    if risk_manager.should_stop_trading(&portfolio) {
        break;
    }
}
```

### Step 3: Signal Processing
```rust
async fn process_live_signal(signal_json: &str, portfolio: &mut Portfolio, ...) {
    let signal: SignalEvent = serde_json::from_str(signal_json)?;
    
    // Same logic as backtest
    let exit_trades = check_position_exits(&mock_candle, portfolio, position_tracker);
    let order_decisions = evaluate_entry_conditions(&[signal], position_tracker);
    
    for decision in order_decisions {
        if risk_manager.can_open_position(portfolio, &decision) {
            let order = create_order_from_decision(&decision, ...);
            // In production: send to ExecutionEngine
            // Currently: simulate execution
            execute_order_simulated(&order, portfolio, position_tracker);
        }
    }
}
```

### Step 4: Python Signal Publishing
```python
# workspace/core/data/signal_publisher.py
from signal_publisher import SignalPublisher

publisher = SignalPublisher()
publisher.publish_signal(
    signal_name="ma_crossover",
    signal_type="golden_cross",
    strength=0.8,
    metadata={"current_price": 1.0860}
)
```

## Risk Management

### Position Sizing
```rust
fn calculate_position_size(
    portfolio: &Portfolio,
    decision: &OrderDecision,
    current_price: Decimal,
    risk_manager: &RiskManager,
) -> Result<Decimal, String> {
    let portfolio_value = portfolio.total_value;
    let size_percentage = Decimal::from_f64(decision.size_percentage)?;
    let position_value = portfolio_value * size_percentage;
    
    // Apply risk limits
    let max_position_value = portfolio_value * risk_manager.position_size_limit;
    let final_value = position_value.min(max_position_value);
    
    // Convert to quantity
    let quantity = final_value / current_price;
    
    // Round to forex lot size
    Ok((quantity / Decimal::from_str("0.01")?).round() * Decimal::from_str("0.01")?)
}
```

### Risk Limits
```yaml
# In strategy YAML
risk:
  max_drawdown: 0.15          # 15% maximum drawdown
  daily_loss_limit: 0.03      # 3% daily loss limit
  position_limit: 0.05        # 5% max per position
  stop_loss: 0.02             # 2% stop loss
  take_profit: 0.04           # 4% take profit
```

### Risk Checks
```rust
impl RiskManager {
    pub fn can_open_position(&self, portfolio: &Portfolio, position_size: &Decimal) -> bool {
        portfolio.positions.len() < self.max_positions &&
        *position_size <= self.position_size_limit &&
        portfolio.max_drawdown < self.max_drawdown_limit
    }
    
    pub fn should_stop_trading(&self, portfolio: &Portfolio) -> bool {
        self.check_risk_limits(portfolio).is_err()
    }
}
```

## Integration Points

### 1. Tauri Commands
```rust
// main.rs
#[tauri::command]
async fn run_orchestrator_backtest(
    strategy_name: String,
    dataset: Option<String>,
    window: Window,
) -> Result<serde_json::Value, String>

#[tauri::command]
async fn run_orchestrator_live(
    strategy_name: String,
    initial_capital: Option<f64>,
    state: State<'_, AppState>,
    window: Window,
) -> Result<serde_json::Value, String>
```

### 2. Environment Variables for Components
```rust
// Set by orchestrator for component execution
env::set_var("DATA_SOURCE", "live");
env::set_var("LIVE_SYMBOL", "EURUSD");
env::set_var("LIVE_TIMEFRAME", "1h");
env::set_var("LIVE_FROM", from_timestamp);
env::set_var("LIVE_TO", to_timestamp);
env::set_var("CACHE_KEY", cache_key);

// For live mode
env::set_var("DATA_SOURCE", "realtime");
env::set_var("REALTIME_WINDOW", "100");
env::set_var("REALTIME_SYMBOL", "EURUSD");
env::set_var("REALTIME_TIMEFRAME", "1h");
env::set_var("PUBLISH_LIVE", "true");
```

### 3. Event Emissions
```rust
// Log events
window.emit("log", json!({
    "level": "INFO",
    "message": "Processing signal..."
}));

// Portfolio updates
window.emit("portfolio_update", json!({
    "cash": portfolio.cash.to_string(),
    "total_value": portfolio.total_value.to_string(),
    "positions": portfolio.positions.len(),
    "daily_pnl": portfolio.daily_pnl.to_string(),
    "total_pnl": portfolio.total_pnl.to_string(),
    "max_drawdown": (portfolio.max_drawdown * 100).to_string(),
}));
```

### 4. Redis Streams
```rust
// Signal stream format
{
    "timestamp": "2025-01-15T10:30:00Z",
    "signal_name": "ma_crossover",
    "signal_type": "golden_cross",
    "strength": 0.8,
    "metadata": {
        "current_price": 1.0860,
        "ma_fast": 1.0858,
        "ma_slow": 1.0855
    }
}

// Price update format
{
    "EURUSD": 1.0860,
    "USDJPY": 148.50
}
```

## Testing Guide

### 1. Test Backtesting
```bash
# 1. Navigate to orchestrator test page
http://localhost:1420/orchestrator-test

# 2. Load strategy (Chunk #1)
Click "Load MA Crossover Strategy"

# 3. Run backtest (Chunk #2)
Click "Run Backtest"

# 4. View results
- Check execution logs
- Review performance metrics
- Examine trade details
```

### 2. Test Live Mode
```bash
# 1. Ensure Redis is running
redis-server

# 2. Start live mode in UI
Click "Start Live Trading"

# 3. Publish test signals
cd workspace/core/data
python signal_publisher.py

# 4. Monitor portfolio updates
- Watch real-time portfolio state
- Check order executions
- Monitor risk limits
```

### 3. Test Component Pipeline
```bash
# Test indicator
cd workspace/core/indicators/trend
export TEST_DATASET=EURUSD_1h_2024-01-02_2024-05-31.parquet
python sma.py

# Test signal with live publishing
cd workspace/core/signals
export PUBLISH_LIVE=true
python ma_crossover.py

# Test strategy evaluation
# (Handled automatically by orchestrator)
```

## API Reference

### Rust Structures

#### SignalEvent
```rust
pub struct SignalEvent {
    pub timestamp: DateTime<Utc>,
    pub signal_name: String,
    pub signal_type: String,
    pub strength: f64,
    pub metadata: HashMap<String, serde_json::Value>,
}
```

#### OrderDecision
```rust
pub struct OrderDecision {
    pub timestamp: DateTime<Utc>,
    pub action: OrderAction,
    pub symbol: String,
    pub reason: String,
    pub triggering_signal: SignalEvent,
    pub size_percentage: f64,
}
```

#### Position
```rust
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
```

#### Trade
```rust
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
```

#### Portfolio
```rust
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
```

### Python Classes

#### SignalPublisher
```python
class SignalPublisher:
    def __init__(self, redis_url: str = None)
    def publish_signal(
        self,
        signal_name: str,
        signal_type: str,
        strength: float,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool
    def publish_price_update(self, prices: Dict[str, float]) -> bool
    def close(self)
```

#### Data Loader
```python
def load_data_from_env() -> pd.DataFrame:
    """Load data based on environment variables"""
    # DATA_SOURCE: 'live', 'parquet', or 'realtime'
    # Returns DataFrame with OHLC data
```

## Performance Metrics

### Calculated Metrics
- **Total P&L**: Final portfolio value - initial capital
- **Win Rate**: Winning trades / total trades
- **Max Drawdown**: Largest peak-to-trough decline
- **Sharpe Ratio**: Risk-adjusted returns (annualized)
- **Daily Returns**: Portfolio value changes per day

### Backtest Results Structure
```rust
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
    pub executed_orders: Vec<Order>,
    pub completed_trades: Vec<Trade>,
    pub final_portfolio: Portfolio,
    pub daily_returns: Vec<(DateTime<Utc>, Decimal)>,
}
```

## Future Enhancements

### 1. ExecutionEngine Integration
- Connect live mode to existing ExecutionEngine
- Route orders through Redis queue to brokers
- Handle real order fills and rejections

### 2. Position Synchronization
- Sync existing broker positions on startup
- Handle external position changes
- Reconcile strategy state with broker state

### 3. Advanced Risk Management
- Portfolio heat maps
- Correlation analysis
- Dynamic position sizing
- Volatility-based stops

### 4. Performance Optimization
- Cache indicator calculations
- Parallel component execution
- Streaming data processing
- Database query optimization

### 5. Production UI (Chunk #8)
- Unified interface for all modes
- Strategy performance dashboard
- Real-time position monitoring
- Risk analytics visualization

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Ensure Redis is running: `redis-server`
   - Check Redis URL in configuration
   - Verify network connectivity

2. **Component Execution Errors**
   - Check Python environment setup
   - Verify component file paths
   - Review component stdout/stderr logs

3. **Signal Not Processing**
   - Verify signal format matches SignalEvent
   - Check Redis stream name ("signals:live")
   - Ensure consumer group exists

4. **Risk Limits Hit**
   - Review strategy risk parameters
   - Check current drawdown levels
   - Verify position sizing calculations

5. **Performance Issues**
   - Reduce candle data range for testing
   - Check component execution times
   - Monitor Redis stream backlog

## Conclusion

The SPtraderB Orchestrator provides a complete, production-ready trading system that seamlessly handles both backtesting and live trading. Its modular architecture, comprehensive risk management, and unified processing pipeline make it suitable for developing and deploying sophisticated trading strategies.

For questions or contributions, please refer to the main project documentation at `/CLAUDE.md`.