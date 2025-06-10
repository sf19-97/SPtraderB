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