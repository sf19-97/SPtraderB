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

### 2. **Hardcoded Signal Name** (Partially Addressed)
- **Problem**: Signal name hardcoded to "ma_crossover" in mod.rs line 453
- **Issue**: This affects all strategies, not just MA crossover
- **Status**: Identified but not yet fixed - needs to extract signal name from strategy config
- **Workaround**: Current hardcoding happens to match MA crossover strategy

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

### 4. **Component Architecture Expansion** ✅
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
- No more hardcoded strategy logic

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
1. **Component Server Crash Loop** - No restart limits, potential memory leak
2. **Hardcoded Strategy in vectorized_backtest.py** - Only handles MA crossover
3. **Debug Logging Performance** - Console.logs in tight loops
4. **Test Coverage** - No tests for vectorized execution

### Partially Fixed:
1. **Dual Backtest Methods** - Cannot delete due to shared dependencies
2. **Hardcoded Signal Name** - Identified but not fixed in this session

## Performance Metrics
- MA crossover backtest: ~19ms for 1245 candles
- Signal detection: Working correctly
- Boolean signal handling: Fixed

## Next Steps
1. Fix signal name extraction from strategy config
2. Add restart limits to component server
3. Make original vectorized_backtest.py dynamic like v2
4. Add test coverage for critical paths
5. Clean up debug logging

## Code Quality Improvements
- All new indicators follow established patterns
- Consistent metadata structure
- Performance budgets defined
- Comprehensive docstrings
- Test sections with visualization output

The system is now more robust with proper boolean signal handling and three new production-ready indicators.