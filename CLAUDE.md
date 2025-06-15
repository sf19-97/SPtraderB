# SPtraderB Project Context

## Project Overview
SPtraderB is a desktop trading application built with Tauri v2 that implements a fractal candlestick charting system. The application automatically adjusts chart timeframes based on zoom levels, providing a seamless multi-resolution viewing experience for forex trading data.

## Technology Stack
- **Frontend**: React + TypeScript with TradingView Lightweight Charts v5
- **Backend**: Rust + Tauri v2
- **Database**: PostgreSQL 17 with TimescaleDB extension
- **Data Source**: Dukascopy historical forex tick data
- **Data Ingestion**: Python script for downloading and processing tick data

## Key Features
1. **Fractal Zoom System**: Automatically switches between timeframes (5m, 15m, 1h, 4h, 12h) based on candle width
2. **Matrix-themed Login**: Falling green characters with "redpill" password access
3. **State Machine**: Prevents race conditions during timeframe transitions
4. **Performance Optimized**: Smart data loading with TimescaleDB continuous aggregates

## Project Structure
- `/src/` - React/TypeScript frontend code
  - `App.tsx` - Main trading interface
  - `components/AdaptiveChart.tsx` - Fractal chart component
  - `components/MatrixLogin.tsx` - Matrix-themed login screen
- `/src-tauri/` - Rust/Tauri backend code
  - Database queries and data serving
- `/data-ingestion/` - Python scripts for data ingestion
  - `dukascopy_ingester.py` - Downloads forex tick data

## Development Commands
```bash
# Start development server
npm run dev

# Run Tauri in development mode
npm run tauri dev

# Build for production
npm run tauri build

# Lint and type checking (if available)
npm run lint
npm run typecheck
```

## Database Setup
The project requires PostgreSQL 17 with TimescaleDB extension. The database contains:
- Tick data table
- Continuous aggregates for 5m, 15m, 1h, 4h, 12h timeframes
- Currently loaded with 5 months of EURUSD data (Jan 2 - May 31, 2024)

## Important Notes
- The Matrix login uses "redpill" as the password
- The fractal zoom switches timeframes when:
  - Candle width < 5 pixels: Switch to higher timeframe (zoom out)
  - Candle width > 30 pixels: Switch to lower timeframe (zoom in)
- State machine prevents concurrent transitions to avoid oscillation

## AdaptiveChart.tsx∙LatestCopyPublish🐛 
Bug Fix: React Closure Issue in Adaptive Chart
Problem:
The adaptive timeframe switching feature was failing after the first transition due to a React closure bug. The setInterval callback was capturing the initial state value and never seeing updates.
Root Cause

setInterval in useEffect with empty dependency array creates a closure
The interval callback always saw currentTimeframe as its initial value
Even after state updates, the interval logic used stale data

Solution
Implemented useRef to mirror the state value:

currentTimeframeRef maintains the current timeframe value
All interval logic now uses currentTimeframeRef.current
Both state and ref are updated together to keep them in sync

Changes Made

Added currentTimeframeRef to track current timeframe in real-time
Updated all interval logic to use the ref instead of state
Modified switchTimeframe to pass previousTimeframe for correct bar spacing calculations
Fixed comparison logic in loadDataAndMaintainView

Testing

✅ Zoom in from 1h → switches to 15m
✅ Zoom out from 15m → switches back to 1h
✅ Multiple zoom transitions work correctly
✅ Manual timeframe selection still works

Lessons Learned
This is a common React pattern that developers should watch for:

Any callback in useEffect with [] dependencies will capture initial state
Use useRef for values that need to be accessed in long-lived callbacks
This applies to: intervals, timers, event listeners, WebSocket handlers

## Recent Updates Log

### Currency Pair Selection & USDJPY Integration
**Date**: January 2025

#### Problem
The trading interface only supported EURUSD. We needed to add support for multiple currency pairs, starting with USDJPY which had been recently ingested.

#### Key Discoveries
1. **USDJPY Decimal Scaling Issue**: The Python ingester was dividing all forex prices by 100,000, which is correct for EUR pairs (5 decimal places) but wrong for JPY pairs which only use 3 decimal places. JPY pairs should be divided by 1,000.
   - Fixed existing USDJPY data in database: `UPDATE forex_ticks SET bid = bid * 100, ask = ask * 100 WHERE symbol = 'USDJPY'`
   - Updated ingester to check for JPY in symbol name

2. **Data Ingestion Process Management**: Implemented cancel functionality for long-running downloads by tracking Python subprocess PIDs in Rust backend state.

#### Implementation
1. Created `PairSelector` component using Mantine Select
2. Added to `MarketDataBar` for easy access
3. Connected to `TradingContext` for state management
4. Updated `AdaptiveChart` to react to symbol changes and reload data

#### Debug Logging Enhancement
Added comprehensive logging to track timeframe changes from the ResolutionTracker:
- All resolution/timeframe logs now prefixed with `[ResolutionTracker]`
- Tracks actual current timeframe using `currentTimeframeRef.current` instead of initial prop
- Provides clear visibility into automatic timeframe transitions based on zoom level

#### Technical Notes
- EURUSD: 5 decimal places (divide by 100,000)
- USDJPY: 3 decimal places (divide by 1,000)
- Download process tracking using HashMap<String, Child> in Rust AppState
- Continuous aggregates must be manually refreshed after bulk data inserts