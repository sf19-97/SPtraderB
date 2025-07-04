# !!README!! PYTHON COMPONENT SERVER & BACKTEST STATE/FUTURE STATE

## Current Architecture - Clear Separation

### 1. BACKTEST MODE (Ground Truth)
```
Rust → vectorized_backtest_v2.py → Results → Exit
```
- **Purpose**: Fast, deterministic ground truth for strategy validation
- **Execution**: Spawns new Python process for each backtest
- **Data Flow**: Sends ALL candles at once
- **Performance**: ~19ms for 1000+ candles
- **Python Files**: 
  - `/workspace/core/utils/vectorized_backtest_v2.py`
- **No persistent process** - clean execution each time

### 2. LIVE MODE (Real-time Responsiveness) 
```
Rust → Component Server → Python Components → Results → Keep Running
```
- **Purpose**: Real-time signal generation with per-candle responsiveness
- **Execution**: Persistent Python subprocess via stdin/stdout
- **Data Flow**: Sends one candle at a time as they arrive
- **Performance**: Sub-millisecond per candle
- **Python Files**:
  - `/src-tauri/src/orchestrator/component_server.py` (persistent server)
  - `/src-tauri/src/orchestrator/component_runner.rs` (Rust side)
- **Persistent process** - stays alive for immediate response

## Why This Separation is GOOD

### Backtest Benefits:
1. **Deterministic**: Same inputs always produce same outputs
2. **Fast**: Process entire history in one shot
3. **Clean**: No state pollution between runs
4. **Ground Truth**: Validates strategies before live deployment

### Live Mode Benefits:
1. **Real-time**: Instant response to new candles
2. **Stateful**: Indicators maintain their state
3. **Low Latency**: No process spawn overhead
4. **Responsive**: Can react to market events immediately

## Current State of Each System

### Backtest System ✅ PRODUCTION READY
- Fully implemented and working
- Supports all strategies dynamically
- Performance optimized
- Used by the UI when running backtests

### Live Mode System 🚧 PARTIALLY IMPLEMENTED
- Component server infrastructure complete
- Has crash protection (max 5 restarts)
- `run_live_mode()` exists but not connected to UI
- Not yet integrated with real brokers
- Ready for real-time signal generation

## Important Architectural Decision

**Batching is NOT suitable for live trading** - Acknowledged and agreed. The component server architecture is the right choice for live mode because:

1. **Market Responsiveness**: Need to react to price changes immediately
2. **Risk Management**: Stop losses and take profits need instant evaluation  
3. **Signal Timing**: Entry/exit signals must be acted on without delay
4. **Broker Integration**: Real brokers expect immediate order placement

## Files and Responsibilities

### Backtest-Only Files:
- `/workspace/core/utils/vectorized_backtest_v2.py` - Vectorized execution
- Test data loading and historical analysis

### Live-Mode-Only Files:
- `/src-tauri/src/orchestrator/component_server.py` - Persistent Python server
- `/src-tauri/src/orchestrator/component_runner.rs` - Server management

### Shared Files (Used by Both):
- `/workspace/core/indicators/*` - All indicators
- `/workspace/core/signals/*` - All signals
- `/workspace/strategies/*` - Strategy YAML files

## Future State Recommendations

### Keep the Separation
The current architecture with separate paths for backtest and live is CORRECT:
- Backtest = Batch processing for speed and ground truth
- Live = Stream processing for responsiveness

### Next Steps for Live Mode:
1. Connect `run_live_mode()` to the UI
2. Integrate with broker APIs
3. Add real-time market data feeds
4. Implement order execution engine
5. Add live position tracking

### What NOT to Change:
- Don't try to use batching for live mode
- Don't try to use component server for backtests
- Keep the clean separation between batch and stream processing

## Key Insight
This separation is a FEATURE, not a bug. Different use cases require different architectures:
- **Backtesting**: Optimize for throughput and determinism
- **Live Trading**: Optimize for latency and responsiveness

Both systems share the same components (indicators/signals) but execute them differently based on their requirements.