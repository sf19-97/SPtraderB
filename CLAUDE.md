# SPtraderB Project Context

## Project Overview
SPtraderB is a desktop trading application built with Tauri v2 that implements a comprehensive trading system with fractal candlestick charting, component-based strategy development, and automated orchestration. The application features automatic timeframe adjustment based on zoom levels and a sophisticated backtesting/live trading orchestrator.

## Technology Stack
- **Frontend**: React + TypeScript with TradingView Lightweight Charts v5
- **Backend**: Rust + Tauri v2
- **State Management**: Zustand (migrated from React Context)
- **Database**: PostgreSQL 17 with TimescaleDB extension
- **Cache**: Redis for live signal streams
- **Data Source**: Dukascopy historical forex tick data
- **Data Ingestion**: Python script for downloading and processing tick data
- **Component Runtime**: Python for indicators/signals/strategies

## Architecture Overview

### State Management (January 2025)
- **Zustand Stores**: All state management uses Zustand
  - `useTradingStore`: Trading UI state (pair, timeframe, chart preferences)
  - `useChartStore`: Chart data caching with LRU eviction
  - `useBrokerStore`: Broker connections and credentials
  - `useOrchestratorStore`: Orchestrator state and backtest results
  - `useBuildStore`: Build center and IDE state
- **No More Contexts**: Migrated away from React Context to avoid confusion

### Data Flow
```
PostgreSQL (Historical) → Rust Backend → Frontend Cache → Charts
Redis (Live Signals) → Orchestrator → Execution Engine → Broker API
```

## Key Features

### 1. Fractal Zoom System
- Automatically switches between timeframes (15m, 1h, 4h, 12h) based on candle width
- Candle width < 5 pixels: Switch to higher timeframe (zoom out)
- Candle width > 30 pixels: Switch to lower timeframe (zoom in)
- State machine prevents concurrent transitions
- Note: 5m candles exist in database but are not used in chart display

### 2. Component-Based Trading System
- **Indicators**: Technical analysis calculations (SMA, RSI, etc.)
- **Signals**: Trading signals based on indicators (crossovers, thresholds)
- **Strategies**: YAML files that combine signals with risk rules
- **Orchestrator**: Executes strategies in backtest or live mode

### 3. Build Center & Monaco IDE
- Full-featured code editor with syntax highlighting
- Real-time component execution with chart preview
- Parquet data export/import for offline testing
- File tree with component type filtering
- Resizable panels and integrated terminal

### 4. Orchestrator
- Unified system for backtesting and live trading
- Executes real Python components (not mocks)
- Chronological candle processing
- Position tracking and P&L calculation
- Risk management with drawdown limits
- Redis integration for live signals

### 5. Data Management
- Automated tick data ingestion from Dukascopy
- TimescaleDB continuous aggregates for performance
- Support for multiple currency pairs (EURUSD, USDJPY)
- Proper decimal handling (5 decimals for EUR, 3 for JPY)

## Project Structure
```
/src/                    # React/TypeScript frontend
  /components/          
    AdaptiveChart.tsx    # Fractal zoom chart
    MonacoIDE.tsx       # Component editor
    orchestrator/       # Orchestrator UI components
  /stores/              # Zustand state management
  /pages/               # Main application pages
  
/src-tauri/             # Rust/Tauri backend
  /orchestrator/        # Strategy execution engine
  /brokers/            # Broker API integrations
  /execution/          # Order execution engine
  
/workspace/             # User trading components
  /core/
    /indicators/        # Technical indicators
    /signals/          # Trading signals
    /data/             # Data utilities
  /strategies/         # Strategy YAML files
  /data/              # Exported test datasets

/data-ingestion/       # Python data pipeline
  dukascopy_ingester.py # Tick data downloader
```

## Development Commands
```bash
# Start development
npm run tauri dev

# Build for production
npm run tauri build

# Frontend only (for UI development)
npm run dev

# Run Python component tests
cd workspace && python core/signals/ma_crossover.py
```

## Current UI Structure

### Main Navigation
1. **Trading Page**: Chart with fractal zoom, market data bar
2. **Build Center**: Component library and Monaco IDE
3. **Orchestrator**: Strategy backtesting and live trading
4. **Data Ingestion**: Download and manage market data
5. **Settings**: Broker configuration (encrypted storage)

### Orchestrator Page Layout
- **Left Panel**: Strategy list and selection
- **Center Panel**: 
  - Top tabs: Backtest, Live Trading, Performance, Risk, Orders
  - Configuration and execution controls
- **Right Panel**: Results with tabs
  - Overview: Performance metrics
  - Chart: Market data with trades
  - Trades: Trade history
  - Logs: System logs (no longer in footer)

## Important Implementation Details

### Backtest Cancellation (January 2025)
- Stop button properly cancels running backtests
- Uses AtomicBool cancellation tokens
- Backtest ID emitted immediately on start
- Frontend can cancel via `cancel_backtest` command

### Component Execution
- Components receive data via environment variables
- `CANDLE_DATA`: JSON array of candles
- `TEST_DATASET`: Selected parquet file for testing
- Output parsed between START/END markers
- Real-time streaming to UI terminal

### Signal Metadata v2
- Signals declare required indicators with parameters
- No Rust changes needed for new indicator combinations
- Example in `/workspace/core/signals/ma_crossover.py`
- Strategies can override signal parameters

### Database Schema
- **forex_ticks**: Raw tick data (bid/ask prices)
- **candles_***: Continuous aggregates for each timeframe
- Volume field represents tick count, not traded volume
- OHLC calculated from bid prices only

## Recent Major Changes (January 2025)

### State Management Migration
- Migrated from React Context to Zustand
- Removed `TradingContext` and `BuildContext`
- Created `useTradingStore` and `useBuildStore`
- Fixed scroll position persistence issue

### Orchestrator UI Cleanup
- Removed redundant nested tabs in BacktestPanel
- Moved logs from footer to dedicated tab
- Results panel always visible (no more disappearing)
- Loading overlay only on Overview tab content

### Component Output Control
- Added `DEBUG_SIGNALS` environment variable
- Suppresses debug output in normal runs
- Essential markers (CHART_DATA, SIGNAL) preserved

## Security Notes
- Broker credentials encrypted with AES-256-GCM
- Stored in Tauri secure storage (OS keychain)
- Never logged or exposed in UI
- API keys masked in settings display

## Known Issues & Workarounds

### Tauri-Specific
- `window.confirm()` doesn't work - use Mantine Modal
- `window.alert()` doesn't work - use notifications
- File paths must be absolute in Rust commands

### Performance
- Data Manager query slow (~13s) - needs optimization
- Large backtest datasets can take time to process
- Chart may lag with >10k candles displayed

## Deprecated Features
The following have been removed:
- Orders IDE (replaced by Orchestrator)
- Order components (orders are now simple data structures)
- TradingContext/BuildContext (replaced by Zustand)
- Multiple component contexts (consolidated to stores)

See `/depreciated/` folder for old implementations.

## Quick Debugging Tips

### Frontend Issues
1. Check browser console for errors
2. React DevTools for component state
3. Network tab for API calls
4. Zustand devtools for store state

### Backend Issues
1. Check terminal for Rust errors
2. Add `emit_log` calls for debugging
3. Database queries in `psql` for verification
4. Redis CLI for live signal debugging

### Common Fixes
- Blank page: Check for null reference errors
- Chart not updating: Verify cache key in store
- Components not running: Check Python path and permissions
- Backtest hanging: Verify cancellation token implementation

## Next Development Priorities
1. Connect orchestrator to real broker APIs
2. Implement production-ready execution engine
3. Add more built-in indicators and signals
4. Performance profiling for components
5. Cloud deployment architecture