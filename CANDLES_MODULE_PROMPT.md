# Candles Module Development Prompt

## Context for AI Assistant

You are working on SPtraderB, a trading application with real-time market data. The project is on branch `market-data-integration` where we just successfully integrated a market data module that follows a proven Bitcoin ingestion pattern.

### Current State
- **Working**: Market data pipeline ingesting forex ticks (GBPUSD confirmed working)
- **Working**: Cascade refresh creating candles every 5 seconds
- **Problem**: Candle logic is scattered across 4+ files causing maintenance nightmare
- **Goal**: Create a unified candles module before adding more features

### Key Files to Review First
1. `MARKET_DATA_INTEGRATION.md` - Current state and refactoring plan
2. `CLAUDE.md` - Project instructions and patterns
3. `src-tauri/src/main.rs` - Lines with fetch_candles commands (bloated)
4. `componentrefactor/src-tauri/src/commands/bitcoin_data.rs` - Bitcoin candle implementation
5. `componentrefactor/src/components/BitcoinTestChart.tsx` - Frontend chart pattern

### Your Task: Create Candles Module

Create a new module at `src-tauri/src/candles/` with this structure:
```
candles/
├── mod.rs       # Unified Candle type and core logic
├── commands.rs  # All candle fetching commands
└── cache.rs     # Centralized cache management
```

#### Step 1: mod.rs
- Define ONE Candle struct that works for all assets (forex, bitcoin, stocks)
- Define table routing logic (symbol → table prefix)
- Export public interface

#### Step 2: commands.rs  
- Move `fetch_candles` and `fetch_candles_v2` from main.rs
- Create `get_market_candles` (generic version of get_bitcoin_chart_data)
- Implement symbol-based routing:
  - BTCUSD → bitcoin_candles_*
  - EURUSD → forex_candles_*
  - AAPL → stock_candles_* (future)

#### Step 3: cache.rs
- Move candle caching logic from main.rs
- Create unified cache interface
- Consider keeping in-memory cache for performance

#### Step 4: Integration
- Update main.rs to use the new module
- Register commands from candles module
- Remove old inline implementations

### Critical Requirements
1. **Maintain compatibility** - Existing frontend code must work unchanged
2. **Follow patterns** - Use the Bitcoin implementation as reference
3. **Test with real data** - GBPUSD is actively ingesting, use it for testing
4. **Keep it simple** - Don't over-engineer, just consolidate what exists

### Database Tables Reference
- Forex: `forex_candles_5m`, `forex_candles_15m`, `forex_candles_1h`, `forex_candles_4h`, `forex_candles_12h`
- Bitcoin: `bitcoin_candles_5m`, `bitcoin_candles_15m`, `bitcoin_candles_1h`, `bitcoin_candles_4h`, `bitcoin_candles_12h`
- All have same structure: time, symbol, open, high, low, close, tick_count

### Success Criteria
- [ ] Single Candle type used everywhere
- [ ] All candle commands in one module
- [ ] Frontend charts still work
- [ ] Can fetch candles for any supported asset
- [ ] Cache performance maintained or improved
- [ ] main.rs reduced by ~200+ lines

### Common Pitfalls to Avoid
1. Don't break existing API contracts
2. Don't forget timezone handling (everything in UTC)
3. Don't mix business logic with database queries
4. Don't create asset-specific code paths unless absolutely necessary

### Testing Commands
```bash
# Check if GBPUSD data exists
psql -U postgres -d forex_trading -c "SELECT COUNT(*) FROM forex_candles_5m WHERE symbol = 'GBPUSD';"

# Test your new command (after implementation)
# Should return same format as existing commands
```

Remember: The goal is consolidation, not innovation. Make the scattered logic organized.