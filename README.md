# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)


# SPtraderB - Fractal Candlestick Chart

A desktop trading application built with Tauri v2 that implements an innovative "fractal" candlestick chart. The chart automatically switches between timeframes based on zoom level, similar to how Google Maps adjusts detail level as you zoom in/out.

## 🚀 Technology Stack

- **Frontend**: React + TypeScript + TradingView Lightweight Charts v5
- **Backend**: Rust + Tauri v2
- **Database**: PostgreSQL 17 with TimescaleDB extension
- **Data Source**: Dukascopy historical forex tick data

## 📊 Project Status

**Current Phase**: State Machine Implementation Complete, Ready for Unsubscribe Pattern

### Working Features
- ✅ Chart renders with proper layout
- ✅ PostgreSQL → Rust → TypeScript → Chart data pipeline
- ✅ Green/red EURUSD candles display correctly
- ✅ Basic zoom detection and timeframe switching (1h ↔ 15m)
- ✅ State machine prevents transition conflicts
- ✅ 5 months of data (Jan 2 - May 31, 2024)

### Known Issues
- ⚠️ Limited panning - only visible data retained
- ⚠️ Oscillation between timeframes when aggressively zooming
- ⚠️ 5m timeframe causes performance issues with large datasets
- ⚠️ Asymmetric transitions (forward works, reverse fails)

## 🏗️ Database Architecture

### TimescaleDB Schema
```sql
-- Main tick data hypertable
CREATE TABLE forex_ticks (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    bid DECIMAL(10,5) NOT NULL,
    ask DECIMAL(10,5) NOT NULL,
    -- ... additional fields
);

-- Continuous aggregates for each timeframe
CREATE MATERIALIZED VIEW forex_candles_5m
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('5 minutes', time) AS time,
    symbol,
    FIRST(bid, time) AS open,
    MAX(bid) AS high,
    MIN(bid) AS low,
    LAST(bid, time) AS close,
    COUNT(*) AS tick_count
FROM forex_ticks
GROUP BY time_bucket('5 minutes', time), symbol;

-- Similar views for: 15m, 1h, 4h, 12h
```

## 🔬 Research Findings

### Core Issues Discovered

1. **Race Condition in Lightweight Charts v5**
   - `setData()` triggers internal scale adjustments
   - These adjustments conflict with user-initiated zoom operations
   - Documented in GitHub issues #998, #549, #584, #1405

2. **Asymmetric Zoom Behavior**
   - Forward transitions (1h → 15m) work because they aggregate data
   - Reverse transitions (15m → 1h) fail due to async processing conflicts
   - The library prioritizes data-driven adjustments over user interactions

3. **Window Size Sensitivity**
   - Pixel-based calculations cause inconsistent behavior
   - Chart works better when smaller (fewer visible candles)
   - Need resolution-independent calculations

### Solution Patterns from Research

1. **State Machine Pattern** ✅ (Implemented)
   - Prevents concurrent transitions
   - Tracks transition state
   - Enforces cooldown periods

2. **Unsubscribe Pattern** 🚧 (Next Step)
   - Unsubscribe from events during transitions
   - Apply data changes
   - Re-subscribe after delay

3. **Resolution-Independent Calculations** 📋 (Planned)
   - Use bar count instead of pixel width
   - Consistent thresholds across window sizes

## 🛠️ Audit Implementation Trail

### Phase 1: Type System Fixes ✅
- Fixed PostgreSQL NUMERIC → Rust f64 type mismatches
- Added explicit FLOAT8 casting in SQL queries
- Resolved timestamp integer/float conflicts

### Phase 2: State Machine Implementation ✅
```javascript
const [chartState, setChartState] = useState({
  currentTimeframe: '1h',
  isTransitioning: false,
  lastTransitionTime: 0,
  visibleRange: null,
  pendingTimeframe: null,
});
```

Key features:
- Blocks transitions during active ones
- 500ms cooldown between transitions
- Disables UI during transitions
- Comprehensive debug logging

### Phase 3: Debug Infrastructure ✅
- Added `[STATE]` prefixed logs for state changes
- Added `[DEBUG]` logs for zoom calculations
- Implemented `window.debugChart()` function
- Pan vs Zoom detection
- Data boundary monitoring

### Phase 4: Data Range Expansion ✅
- Expanded from 1 week to 5 months of data
- Smart initial views per timeframe
- 5-minute data limiting (7-day windows)
- Performance warnings for large datasets

## 🔄 Next Steps

### Immediate: Unsubscribe Pattern Implementation
```javascript
// Pseudocode for next implementation
const subscription = timeScale().subscribeVisibleLogicalRangeChange(handler);
// Before data load
subscription.unsubscribe();
// Load data, setData()
// After delay
timeScale().subscribeVisibleLogicalRangeChange(handler);
```

### Future Improvements
1. Implement resolution-independent calculations
2. Add data caching layer
3. Implement zoom history/undo
4. Add loading indicators during transitions
5. Optimize data fetching (load only visible + buffer)

## 🚦 Running the Project

```bash
# Prerequisites
brew services start postgresql@17

# Development
cd /Users/sebastian/Projects/SPtraderB
npm run tauri dev

# Debug in browser console
debugChart()  // Shows complete chart state
```

## 📈 Expected Behavior

### Timeframe Progression
- **Zoom In** (more detail): 12h → 4h → 1h → 15m → 5m
- **Zoom Out** (less detail): 5m → 15m → 1h → 4h → 12h

### Candle Width Thresholds
- **< 5 pixels**: Switch to higher timeframe (zoom out)
- **> 30 pixels**: Switch to lower timeframe (zoom in)

### Initial Views
- **5m**: Last 1 day (288 candles)
- **15m**: Last 2 days (192 candles)
- **1h**: Last 1 week (168 candles)
- **4h**: Last 2 weeks (84 candles)
- **12h**: Last 1 month (60 candles)

## 🐛 Debugging Tips

1. **Console Logs**: Watch for `[STATE]` and `[DEBUG]` prefixes
2. **Performance**: >1000 candles will show warnings
3. **Boundaries**: "Hit LEFT/RIGHT boundary" messages indicate data limits
4. **Transitions**: "Transition blocked" messages prevent race conditions

## 📚 References

- [TradingView Lightweight Charts Documentation](https://tradingview.github.io/lightweight-charts/)
- [Tauri v2 Documentation](https://v2.tauri.app/)
- [TimescaleDB Continuous Aggregates](https://docs.timescale.com/use-timescale/latest/continuous-aggregates/)

## 🙏 Acknowledgments

Special thanks to the Senior Data Pipeline Auditor (Claude) for the brutal honesty and institutional-grade standards that got this project on track.

---
