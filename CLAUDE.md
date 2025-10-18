# SPtraderB - What You Need to Know

## CRITICAL DOCUMENT - READ FIRST
**`data-ingestion/BITCOIN_CASCADE_PATTERN.md`** - This is THE MOST IMPORTANT document in the entire codebase. It contains the ONLY working solution for real-time data with hierarchical aggregates. This pattern runs 24/7 in production. DO NOT deviate from it.

## The Working Pattern
Study these three files - they show the complete Bitcoin implementation that works:
- `data-ingestion/direct-bitcoin-ingester.py` - WebSocket → PostgreSQL ingestion
- `src-tauri/src/commands/bitcoin_data.rs` - Backend data queries  
- `src/components/BitcoinTestChart.tsx` - Frontend fractal zoom chart

This pattern works. Copy it for new assets.

## Critical Rules
1. **Aggregates cascade from raw ticks**
   - Order: bitcoin_ticks → 1m → 5m → 15m → 1h → 4h → 12h
   - MUST refresh sequentially or higher timeframes get stale data
   - Use negative end_offsets (e.g., `-5 seconds`) to include recent data

2. **Direct connections only**
   - WebSocket → PostgreSQL → Frontend
   - No Pulsar, no Docker, no message queues
   - If you're adding middleware, stop

3. **These components already work - don't recreate them**
   - BuildHub
   - IDE  
   - Component runtime system

## Common Issues
- "Candles not updating" → Check cascade refresh order
- "Memory pressure high" → It's macOS file cache, not the app (we use ~370MB)
- "Need real-time data" → Follow direct-bitcoin-ingester.py pattern

## Key Question
Before suggesting any solution, ask: "Does this code run in production right now?"

## How to Extend
To add a new asset:

1. Copy direct-bitcoin-ingester.py
2. Modify broker connection and parsing
3. Use same table structure and aggregation pattern
4. That's it

When in doubt, ask the user. They know more than this file.

## Candle Type Architecture

The codebase has multiple Candle types for different layers:

### String-based (API/Database layer):
- `BitcoinCandle` (src/commands/bitcoin_data.rs) - Bitcoin-specific API responses
- `MarketCandle` (src/candles/mod.rs) - Generic market data API responses
- Both use strings for prices to preserve database precision

### Numeric-based (Processing layer):
- `main::Candle` (src/main.rs) - In-memory caching with f64 for performance
- `orchestrator::Candle` (src/orchestrator/mod.rs) - Backtesting with Decimal for precision

### Special purpose:
- `CandleData` (src/workspace.rs) - Vectorized format for bulk operations
- `CandleUpdateNotification` (src/candle_monitor.rs) - PostgreSQL notifications

### Caching Issue:
- `AppState.candle_cache` expects `main::Candle` (numeric)
- But `get_market_candles` returns `MarketCandle` (strings)
- Cannot mix types without conversion

Typical flow: Database (strings) → API types (strings) → Cache types (f64) → Orchestrator types (Decimal)

## Development Setup
Rust-analyzer is configured with:
- **checkOnSave disabled** - Run checks manually with Ctrl+Shift+P → "rust-analyzer: Run flycheck"
- **Readonly stdlib paths** - Prevents accidental edits to Rust standard library
- **Faster saves** - No waiting for cargo check after each save

See `.vscode/settings.json` for the configuration.

## Recent Architectural Improvements (Jan 2025)

### Data Coordination Layer
- **ChartDataCoordinator** (`src/services/ChartDataCoordinator.ts`) - Centralized data fetching with:
  - Request deduplication (prevents duplicate backend calls)
  - Cache key normalization matching backend logic
  - Default range management per symbol-timeframe
  - Metadata caching from candle responses

### State Management
- **ChartStateMachine** (`src/machines/chartStateMachine.ts`) - XState machine handling:
  - Complex state transitions (idle → loading → ready → transitioning)
  - Automatic timeframe switching based on bar spacing
  - Zoom state management (shift key locking)
  - Animation coordination with cooldowns

### Reusable Hooks
- **useChartSetup** - Chart initialization with theme support
- **useChartZoom** - Zoom functionality, shift key handling, bar spacing monitoring
- **useAutoTimeframeSwitch** - Automatic timeframe logic with thresholds
- **useChartData** - Clean data fetching interface

### Performance Fixes
- Eliminated redundant data fetches (removed 3 duplicate fetch triggers)
- Fixed cache misses by using consistent timestamp normalization
- Increased initial zoom levels to prevent unwanted auto-switching
- All data requests now go through coordinator for consistency

### Cache Normalization
Frontend and backend use same normalization factors:
- 5m: 900s (15 min windows)
- 15m: 3600s (1 hour windows)
- 1h: 7200s (2 hour windows)
- 4h: 14400s (4 hour windows)
- 12h: 43200s (12 hour windows)

### MarketDataChart Refactoring Status
The 1300+ line MarketDataChart component is being decomposed:
- ✅ Phase 1: Data coordination layer (ChartDataCoordinator)
- ✅ Phase 2: State machine (ChartStateMachine)
- 🚧 Phase 3: Extract view logic (useChartSetup, useChartZoom done)
- 📋 Phase 4: Component decomposition
- 📋 Phase 5: Performance optimization

## API Credentials
OANDA Demo Account:
- API Key: 599289f40105f4990595e53da4d05473-aff0283ed6b217cbbac90a1a5932f19e
- Account ID: 101-001-25044301-001
