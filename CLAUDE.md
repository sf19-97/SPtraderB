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

