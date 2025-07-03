# Orchestrator Development Log #2
Date: 2025-01-02

## Session Overview
Fixed MA crossover strategy not generating orders and created new indicators following the component architecture.

## Issues Fixed

### 1. **Component Executor Shutdown Bug** ✅
- **Problem**: `run_backtest_vectorized()` was calling `shutdown_component_executor()` without ever initializing it
- **Root Cause**: Vectorized backtest uses standalone Python process, not the component executor
- **Fix**: Removed lines 614-619 in `/src-tauri/src/orchestrator/mod.rs`
- **Result**: No more incorrect shutdown attempts

### 2. **Signal Name Field Addition** ✅
- **Problem**: Signal events from Python weren't including the 'signal_name' field
- **Root Cause**: vectorized_backtest_v2.py wasn't adding signal_name to events
- **Fix**: Added line 181: `event['signal_name'] = signal_path.split('.')[-1]`
- **Note**: mod.rs line 453 was already set up to read signal_name dynamically

### 3. **MA Crossover Strategy Not Generating Orders** ✅
- **Initial Theory**: `signal_strength: "> 0.1"` condition filtering out signals
- **Fix Attempt 1**: Removed signal_strength condition from strategy YAML
- **Real Issue**: Vectorized backtest v2 was checking `signal != 0` but MA crossover returns boolean
- **Fix**: Updated vectorized_backtest_v2.py to handle both boolean and numeric signals
```python
signal_value = signal_df.loc[idx, 'signal']
if (isinstance(signal_value, bool) and signal_value) or (signal_value != 0):
```
- **Result**: Signals now properly detected, but test period only had death crosses

### 4. **Component Server Crash Protection** ❌ (Wrong Target)
- **What was done**: Added restart limits and exponential backoff to component_runner.rs
- **Problem**: Component server is NOT used by `run_backtest_vectorized()`
- **Reality**: Only used by old `run_backtest()` and `run_live_mode()`
- **Result**: Wasted effort - protection won't help during backtests

### 5. **Component Architecture Expansion** ✅
Created three new indicators following the established pattern:

#### ADX (Average Directional Index)
- **Location**: `/workspace/core/indicators/momentum/adx.py`
- **Features**: Trend strength measurement, Wilder's smoothing
- **Outputs**: ADX, +DI, -DI values
- **Performance**: < 2.0ms budget

#### Bollinger Bands
- **Location**: `/workspace/core/indicators/volatility/bb.py`
- **Features**: Volatility bands, %B calculation, bandwidth
- **Outputs**: upper, middle, lower, bandwidth, percent_b
- **Performance**: < 1.0ms budget

#### EMA (Exponential Moving Average)
- **Location**: `/workspace/core/indicators/trend/ema.py`
- **Features**: Exponential weighting, faster response than SMA
- **Outputs**: ema value
- **Performance**: < 0.5ms budget

## Architecture Insights

### Signal Format Evolution
Discovered two signal formats in the system:

**Old Format (MA Crossover)**:
- Class-based with `evaluate()` method
- Returns DataFrame with signal columns
- ~320 lines of code

**New Format (EMA Crossover)**:
- Function-based with `generate_signals()`
- Returns list of signal dictionaries
- ~175 lines of code

### Vectorized Backtest v2 Compatibility
The new `vectorized_backtest_v2.py` handles both formats:
- Dynamically loads components with `importlib`
- Supports both 'params' and 'parameters' keys
- Handles class-based and function-based signals
- No more hardcoded strategy logiccan 

## Key Discoveries

### 1. **Boolean vs Numeric Signals**
- MA crossover uses boolean True/False for signals
- Other signals might use numeric 1/-1/0
- v2 backtest now handles both correctly

### 2. **Signal Matching Logic**
- Orchestrator matches `crossover_type` from YAML to `signal.signal_type`
- Signal events must include correct `signal_name` field
- Debug logging revealed signals were being generated but not matching conditions

### 3. **Test Data Limitations**
- 20-day test period only contained death crosses
- No golden crosses = no buy orders = no trades
- Strategy working correctly, just no favorable signals in test period

## Remaining Issues (from Log #1)

### Still Need Fixing:
1. **Component Server Crash Loop** - ⚠️ Fixed but only affects live mode, not backtests
2. **Hardcoded Strategy in vectorized_backtest.py** - Only handles MA crossover
3. **Debug Logging Performance** - Console.logs in tight loops (partially cleaned)
4. **Test Coverage** - No tests for vectorized execution

### Partially Fixed:
1. **Dual Backtest Methods** - Cannot delete due to shared dependencies

## Performance Metrics
- MA crossover backtest: ~19ms for 1245 candles
- Signal detection: Working correctly
- Boolean signal handling: Fixed

## Architecture Confusion Discovered

### Component Server vs Direct Python Execution
1. **Component Server** (`component_server.py`):
   - Only used by old `run_backtest()` and `run_live_mode()`
   - Persistent Python process with stdin/stdout communication
   - Needed for per-candle execution in live mode

2. **Direct Python** (`vectorized_backtest_v2.py`):
   - Used by `run_backtest_vectorized()` (what we're actually using)
   - Spawns new Python process for each backtest
   - No persistent server, no crash loop risk

### Implications
- Component server crash protection was added to wrong part of system
- Backtests don't use component server at all
- Protection only helps live trading mode
- No crash loop risk in current backtest implementation

## Next Steps
1. Create wrapper to redirect old backtest to vectorized
2. Delete old vectorized_backtest.py (v1)
3. Add test coverage for vectorized execution
4. Clean remaining console.log statements
5. Consider if component server is even needed long-term

## Code Quality Improvements
- All new indicators follow established patterns
- Consistent metadata structure
- Performance budgets defined
- Comprehensive docstrings
- Test sections with visualization output

The system is now more robust with proper boolean signal handling and three new production-ready indicators.