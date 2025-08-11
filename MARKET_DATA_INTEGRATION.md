# Market Data Integration Documentation

## Overview
This document describes the market data module integration that evolves the proven Bitcoin pattern into a more integrated solution within the SPtraderB application.

## Current State (as of commit e5af1e7)

### What Works
1. **Ingestion Pipeline**
   - Oanda ingester successfully connects with stored credentials
   - Ticks are written to forex_ticks table (10,126 EURGBP ticks ingested)
   - Batched inserts with 100 tick batches or 5-second intervals

2. **Cascade Refresh**
   - External cascade running every 5 seconds
   - Clock-aligned at :01, :06, :11, :16, :21, :26, :31, :36, :41, :46, :51, :56
   - Successfully creates candles (76 5m candles, 7 1h candles for EURGBP)

3. **Frontend Integration**
   - AssetManager component for pipeline management
   - Credentials flow from broker store to backend
   - Real-time pipeline status monitoring

### Architecture Decisions

#### Why External Cascade?
TimescaleDB has a fundamental limitation:
- Jobs can only call FUNCTIONS
- refresh_continuous_aggregate() can only be called from PROCEDURES
- Functions cannot call procedures (transaction boundary issue)
- Therefore: External scheduling is the ONLY solution

#### Module Structure
```
market_data/
├── mod.rs           # Core types and traits
├── commands.rs      # Tauri commands
├── pipeline.rs      # Pipeline implementation
└── ingesters/       # Source-specific implementations
    ├── mod.rs
    ├── oanda.rs     # Forex via Oanda
    ├── kraken.rs    # Crypto via Kraken
    └── alpaca.rs    # Stocks via Alpaca (stub)
```

### Key Fixes Applied

1. **INSERT Query Fix**
   - Original: Tried to insert `last` and `volume` columns
   - Fixed: Only inserts columns that exist in forex_ticks
   - Correct columns: time, symbol, source, bid, ask

2. **ON CONFLICT Fix**
   - Original: (symbol, source, time)
   - Fixed: (symbol, time) to match actual constraint

3. **Tauri v2 Imports**
   - Changed from `@tauri-apps/api/tauri`
   - To: `@tauri-apps/api/core`

### Database Schema
```sql
-- forex_ticks table (existing)
time       TIMESTAMPTZ
symbol     VARCHAR(10)
bid        NUMERIC(10,5)
ask        NUMERIC(10,5)
bid_size   INTEGER
ask_size   INTEGER
spread     NUMERIC(8,5) GENERATED
mid_price  NUMERIC(10,5) GENERATED
source     VARCHAR(50)

-- Cascade procedure (created)
CASCADE_forex_aggregate_refresh()
  → forex_candles_5m
  → forex_candles_15m
  → forex_candles_1h
  → forex_candles_4h
  → forex_candles_12h
```

## Next Steps

### Immediate Tasks
1. **Chart Integration**
   - Create market data candle fetching commands
   - Adapt BitcoinTestChart to be generic
   - Replace/supplement AdaptiveChart

2. **Code Organization**
   - Extract commands from bloated main.rs
   - Move command implementations to respective modules
   - Create unified command structure

3. **Architecture Improvements**
   - Split monolithic AppState
   - Standardize ingestion patterns
   - Reduce component duplication

### Future Considerations
1. **Monitoring**
   - Add pipeline health checks
   - Track ingestion rates
   - Monitor cascade lag

2. **Error Handling**
   - Reconnection improvements
   - Better error propagation
   - User notifications

3. **Performance**
   - Optimize batch sizes
   - Tune cascade intervals
   - Add compression policies

## Lessons Learned

1. **Study First, Code Second**
   - Understanding existing patterns prevents conflicts
   - The Bitcoin pattern was proven and should be followed

2. **Respect System Limitations**
   - TimescaleDB's job system cannot handle procedures
   - External scheduling is not a workaround, it's the solution

3. **Integration Over Revolution**
   - Evolve existing patterns rather than replacing them
   - Keep what works (external cascade, direct connections)

## Testing the Integration

1. **Start the cascade refresh** (if not already running):
   ```bash
   launchctl load ~/Library/LaunchAgents/com.sptraderb.bitcoin-cascade-refresh.plist
   ```

2. **Add an asset** through the UI:
   - Navigate to Market Data page
   - Search for asset (e.g., GBPUSD)
   - Select Oanda as source
   - Click Add

3. **Verify data flow**:
   ```sql
   -- Check ticks
   SELECT COUNT(*), MAX(time) FROM forex_ticks WHERE symbol = 'GBPUSD';
   
   -- Check candles
   SELECT COUNT(*), MAX(time) FROM forex_candles_5m WHERE symbol = 'GBPUSD';
   ```

## Architectural Refactoring: Candles Module

### The Problem
Candle logic is scattered across multiple files:
- `main.rs` - fetch_candles, fetch_candles_v2 commands  
- `bitcoin_data.rs` - BitcoinCandle type and get_bitcoin_chart_data
- `market_data/` - Will need its own candle fetching
- Frontend has multiple candle representations

This violates DRY and makes the codebase hard to maintain.

### The Solution: Dedicated Candles Module
```
src-tauri/src/candles/
├── mod.rs       # Unified Candle type and core logic
├── commands.rs  # All candle fetching commands  
└── cache.rs     # Centralized cache management
```

### Benefits
1. **Single Source of Truth** - One Candle type for all assets
2. **Discoverability** - Candle logic in one obvious place
3. **Maintainability** - Changes in one place affect all assets
4. **Testability** - Isolated module with clear boundaries

### Implementation Notes
- Move existing fetch_candles from main.rs
- Generalize bitcoin_data.rs logic for all assets
- Create routing based on symbol patterns
- Consolidate cache logic from multiple sources

**This refactoring should happen BEFORE adding more candle-fetching commands to prevent further fragmentation.**

## References
- Bitcoin Pattern: `componentrefactor/data-ingestion/BITCOIN_CASCADE_PATTERN.md`
- Original Schema: `componentrefactor/docs/BITCOIN_DATABASE_SCHEMA.md`
- Implementation: `componentrefactor/BITCOIN_IMPLEMENTATION_FILES.md`