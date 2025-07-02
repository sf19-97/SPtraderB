# Orchestrator Quick Reference Guide

## Quick Start

### 1. Run a Backtest
```bash
# UI Method
1. Navigate to http://localhost:1420/orchestrator-test
2. Click "Load MA Crossover Strategy"
3. Click "Run Backtest"

# Check Results
- Total P&L, Sharpe ratio, win rate
- Execution logs with trades
- Order decisions and risk checks
```

### 2. Start Live Trading
```bash
# Prerequisites
redis-server  # Start Redis

# UI Method
1. Load strategy first (Chunk #1)
2. Click "Start Live Trading"
3. Run signal publisher:
   cd workspace/core/data
   python signal_publisher.py
```

### 3. Create a New Strategy
```yaml
# workspace/strategies/my_strategy.yaml
name: my_strategy
version: 1.0.0
author: your_name
description: My trading strategy

dependencies:
  indicators: [core.indicators.trend.sma]
  signals: [core.signals.ma_crossover]

parameters:
  position_size: 0.02  # 2% per trade
  max_positions: 3

entry:
  when:
    - signal: ma_crossover
      outputs:
        crossover_type: golden_cross
  action: buy
  size: parameters.position_size

risk:
  max_drawdown: 0.10      # 10%
  daily_loss_limit: 0.02  # 2%
  stop_loss: 0.01         # 1%
  take_profit: 0.02       # 2%
```

## Component Development

### Create an Indicator
```python
# workspace/core/indicators/my_indicator.py
import pandas as pd
from core.data.loader import load_data_from_env

# Metadata
__metadata__ = {
    'name': 'my_indicator',
    'type': 'indicator',
    'parameters': {'period': 14}
}

if __name__ == "__main__":
    data = load_data_from_env()
    
    # Calculate indicator
    result = data['close'].rolling(14).mean()
    
    # Output for orchestrator
    print(f"Last value: {result.iloc[-1]}")
```

### Create a Signal
```python
# workspace/core/signals/my_signal.py
import json
from datetime import datetime
from core.data.loader import load_data_from_env

# Enhanced metadata
__metadata_version__ = 2
__metadata__ = {
    'required_indicators': [
        {'name': 'fast_ma', 'type': 'sma', 'params': {'period': 10}},
        {'name': 'slow_ma', 'type': 'sma', 'params': {'period': 20}}
    ]
}

if __name__ == "__main__":
    data = load_data_from_env()
    
    # Calculate indicators (in real use, orchestrator provides these)
    fast_ma = data['close'].rolling(10).mean()
    slow_ma = data['close'].rolling(20).mean()
    
    # Detect signals
    signal_events = []
    if fast_ma.iloc[-1] > slow_ma.iloc[-1]:
        signal_events.append({
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "signal_name": "my_signal",
            "signal_type": "bullish",
            "strength": 0.8,
            "metadata": {"price": float(data['close'].iloc[-1])}
        })
    
    # Output for orchestrator
    print("\nSIGNAL_START")
    print(json.dumps(signal_events))
    print("SIGNAL_END")
```

## Environment Variables

### Backtest Mode
```bash
DATA_SOURCE=live
LIVE_SYMBOL=EURUSD
LIVE_TIMEFRAME=1h
LIVE_FROM=1704153600    # Unix timestamp
LIVE_TO=1717200000      # Unix timestamp
CACHE_KEY=unique_key
```

### Live Mode
```bash
DATA_SOURCE=realtime
REALTIME_WINDOW=100
REALTIME_SYMBOL=EURUSD
REALTIME_TIMEFRAME=1h
PUBLISH_LIVE=true       # Enable Redis publishing
```

## Common Commands

### Test Components
```bash
# Test indicator
cd workspace/core/indicators/trend
export TEST_DATASET=EURUSD_1h_2024-01-02_2024-05-31.parquet
python sma.py

# Test signal
cd workspace/core/signals
python ma_crossover.py

# Test with live publishing
export PUBLISH_LIVE=true
python ma_crossover.py
```

### Redis Commands
```bash
# Monitor signal stream
redis-cli
> XREAD BLOCK 0 STREAMS signals:live $

# Publish test signal
> XADD signals:live * signal '{"signal_name":"test","signal_type":"buy","strength":0.5}'

# Check consumer groups
> XINFO GROUPS signals:live
```

### Export Test Data
```typescript
// In IDE or UI
await invoke('export_test_data', {
    symbol: 'EURUSD',
    timeframe: '1h',
    fromDate: '2024-01-01',
    toDate: '2024-12-31',
    filename: 'eurusd_2024.parquet'
});
```

## Risk Management Rules

### Position Sizing Formula
```
position_value = portfolio_value * size_percentage
max_allowed = portfolio_value * position_size_limit
final_value = min(position_value, max_allowed)
quantity = final_value / current_price
rounded = round(quantity / 0.01) * 0.01  # Forex lots
```

### Risk Checks
1. **Max Positions**: `positions.len() < max_positions`
2. **Position Size**: `size <= position_size_limit`
3. **Drawdown**: `max_drawdown < max_drawdown_limit`
4. **Daily Loss**: `daily_loss < daily_loss_limit`

### Stop Loss / Take Profit
```
# Long position
stop_loss = entry_price * (1 - stop_loss_percent)
take_profit = entry_price * (1 + take_profit_percent)

# Short position
stop_loss = entry_price * (1 + stop_loss_percent)
take_profit = entry_price * (1 - take_profit_percent)
```

## Performance Metrics

### Sharpe Ratio
```
daily_returns = portfolio_values.pct_change()
mean_return = daily_returns.mean()
std_dev = daily_returns.std()
sharpe = (mean_return * sqrt(252)) / std_dev
```

### Maximum Drawdown
```
high_water_mark = portfolio_values.cummax()
drawdown = (high_water_mark - portfolio_values) / high_water_mark
max_drawdown = drawdown.max()
```

## Troubleshooting

### Component Not Running
```bash
# Check Python path
which python

# Test component directly
python workspace/core/indicators/trend/sma.py

# Check for errors in logs
grep ERROR ~/.tauri/sptraderb.log
```

### Redis Connection Issues
```bash
# Check Redis is running
redis-cli ping

# Check Redis URL
echo $REDIS_URL

# Test connection
redis-cli -h localhost -p 6379
```

### Signal Not Processing
```python
# Verify signal format
{
    "timestamp": "2025-01-15T10:30:00Z",
    "signal_name": "ma_crossover",
    "signal_type": "golden_cross",
    "strength": 0.8,
    "metadata": {}
}

# Check orchestrator logs for parsing errors
```

### Risk Limits Hit
```yaml
# Adjust in strategy YAML
risk:
  max_drawdown: 0.20      # Increase to 20%
  daily_loss_limit: 0.05  # Increase to 5%
```

## File Structure

```
/workspace/
├── core/
│   ├── indicators/
│   │   └── trend/
│   │       └── sma.py
│   ├── signals/
│   │   └── ma_crossover.py
│   └── data/
│       ├── loader.py
│       └── signal_publisher.py
├── strategies/
│   └── ma_crossover_strategy.yaml
└── data/
    └── *.parquet  # Test datasets

/src-tauri/src/
├── orchestrator/
│   └── mod.rs     # Main orchestrator
├── orders/
│   └── mod.rs     # Order structures
└── main.rs        # Tauri commands
```

## Key Rust Types

```rust
// Signal from Python
SignalEvent {
    timestamp: DateTime<Utc>,
    signal_name: String,
    signal_type: String,
    strength: f64,
    metadata: HashMap<String, Value>
}

// Order decision
OrderDecision {
    action: OrderAction,
    symbol: String,
    size_percentage: f64,
    triggering_signal: SignalEvent
}

// Portfolio state
Portfolio {
    cash: Decimal,
    positions: HashMap<String, Position>,
    total_value: Decimal,
    daily_pnl: Decimal,
    max_drawdown: Decimal
}
```

## Python Utilities

```python
# Load data
from core.data.loader import load_data_from_env
data = load_data_from_env()

# Publish signals
from core.data.signal_publisher import SignalPublisher
publisher = SignalPublisher()
publisher.publish_signal("name", "type", 0.8, {})

# Export data
await invoke('export_test_data', params)
```

## Testing Checklist

- [ ] Strategy YAML syntax valid
- [ ] Indicators calculate correctly
- [ ] Signals output proper format
- [ ] Risk limits reasonable
- [ ] Backtest runs without errors
- [ ] Live mode receives signals
- [ ] Portfolio updates in UI
- [ ] Stop loss/take profit work
- [ ] Daily returns calculated
- [ ] Sharpe ratio reasonable

## Next Steps

1. **Create Custom Indicators**: Build domain-specific technical indicators
2. **Develop Signals**: Implement pattern recognition signals
3. **Design Strategies**: Combine signals with risk management
4. **Optimize Parameters**: Use backtest results to tune
5. **Deploy Live**: Connect to real broker via ExecutionEngine