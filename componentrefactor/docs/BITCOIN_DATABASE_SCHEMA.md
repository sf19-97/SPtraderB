# Bitcoin Database Schema Documentation

## Overview
This document describes the Bitcoin data schema for SPtraderB, which mirrors the forex_ticks structure to maintain consistency across different asset classes. The schema uses PostgreSQL with TimescaleDB extension for efficient time-series data storage and automatic candle generation.

## Schema Design Philosophy
The Bitcoin schema is designed to be identical to the forex schema, enabling:
- Consistent data handling across asset classes
- Reusable code for data ingestion and processing
- Unified backtesting and analysis capabilities
- Easy addition of other cryptocurrencies using the same structure

## Database Tables

### 1. bitcoin_ticks (Base Table)
Stores raw tick data for Bitcoin and other cryptocurrencies.

**Structure:**
```sql
CREATE TABLE bitcoin_ticks (
    time TIMESTAMPTZ NOT NULL,           -- Tick timestamp in UTC
    symbol VARCHAR(10) NOT NULL,         -- Symbol (e.g., BTCUSD, ETHUSD)
    bid NUMERIC(10,5) NOT NULL,          -- Bid price with 5 decimal precision
    ask NUMERIC(10,5) NOT NULL,          -- Ask price with 5 decimal precision
    bid_size INTEGER DEFAULT 0,          -- Bid volume in units
    ask_size INTEGER DEFAULT 0,          -- Ask volume in units
    spread NUMERIC(8,5) GENERATED,       -- Calculated spread (ask - bid)
    mid_price NUMERIC(10,5) GENERATED,   -- Calculated mid price ((bid + ask) / 2)
    PRIMARY KEY (symbol, time)
);
```

**Key Features:**
- Composite primary key `(symbol, time)` prevents duplicates
- Generated columns for spread and mid_price
- Supports UPSERT operations for data updates
- TimescaleDB hypertable with 7-day chunks

**Data Characteristics:**
- Bitcoin trades 24/7 unlike forex markets
- Higher volatility may result in more ticks per day
- Price precision: 5 decimal places (e.g., 97500.50000)
- Volume data more meaningful than forex tick counts

### 2. bitcoin_candle_refresh_metadata
Tracks the last refresh timestamp for continuous aggregates.

**Structure:**
```sql
CREATE TABLE bitcoin_candle_refresh_metadata (
    symbol VARCHAR(10) PRIMARY KEY,
    last_refresh_timestamp TIMESTAMPTZ,
    last_tick_timestamp TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

## Continuous Aggregates (Candle Views)

### Hierarchical Cascade
Bitcoin candles follow the same hierarchical structure as forex:
```
bitcoin_ticks (raw tick data)
    ↓
bitcoin_candles_5m (from ticks)
    ↓
bitcoin_candles_15m (from 5m: 3 x 5m = 15m)
    ↓
bitcoin_candles_1h (from 15m: 4 x 15m = 1h)
    ↓
bitcoin_candles_4h (from 1h: 4 x 1h = 4h)
    ↓
bitcoin_candles_12h (from 4h: 3 x 4h = 12h)
```

### Candle Structure (All Timeframes)
Each candle view has the same structure:
```sql
- time: TIMESTAMPTZ       -- Candle start time
- symbol: VARCHAR(10)     -- Cryptocurrency symbol
- open: NUMERIC          -- First bid price in period
- high: NUMERIC          -- Highest bid price in period
- low: NUMERIC           -- Lowest bid price in period
- close: NUMERIC         -- Last bid price in period
- tick_count: NUMERIC    -- Number of ticks (activity indicator)
```

### Aggregation Rules
1. **OHLC from Bid Prices**: Like forex, candles use bid prices only
2. **Tick Count as Volume**: Number of price updates, not traded volume
3. **Time Bucketing**: Uses TimescaleDB's time_bucket function
4. **Cascading Updates**: Higher timeframes aggregate from lower ones

## Key Differences from Forex

### Market Hours
- **Bitcoin**: 24/7/365 trading (no market close)
- **Forex**: Weekday trading with weekend gaps
- **Impact**: More consistent data without gaps

### Volume Semantics
- **Bitcoin**: Real traded volume available from exchanges
- **Forex**: Only tick count (number of price updates)
- **Current Design**: Uses tick_count for consistency

### Price Volatility
- **Bitcoin**: Higher volatility, larger price swings
- **Forex**: Lower volatility, smaller pip movements
- **Impact**: May need different risk parameters

## Usage Examples

### Insert Bitcoin Tick Data
```sql
INSERT INTO bitcoin_ticks (time, symbol, bid, ask, bid_size, ask_size)
VALUES 
    ('2025-01-06 12:00:00+00', 'BTCUSD', 97500.50, 97501.00, 100, 150),
    ('2025-01-06 12:00:01+00', 'BTCUSD', 97501.00, 97501.50, 200, 100)
ON CONFLICT (symbol, time) 
DO UPDATE SET 
    bid = EXCLUDED.bid,
    ask = EXCLUDED.ask,
    bid_size = EXCLUDED.bid_size,
    ask_size = EXCLUDED.ask_size;
```

### Refresh Candles
```sql
-- Using the helper function
SELECT refresh_bitcoin_candles('BTCUSD', '2025-01-01', '2025-01-07');

-- Or manually in order
CALL refresh_continuous_aggregate('bitcoin_candles_5m', '2025-01-01', '2025-01-07');
CALL refresh_continuous_aggregate('bitcoin_candles_15m', '2025-01-01', '2025-01-07');
-- ... continue for other timeframes
```

### Query Candles
```sql
-- Get latest 1-hour candles
SELECT * FROM bitcoin_candles_1h 
WHERE symbol = 'BTCUSD' 
AND time >= NOW() - INTERVAL '7 days'
ORDER BY time DESC;

-- Get daily high/low from 4h candles
SELECT 
    date_trunc('day', time) as day,
    symbol,
    MAX(high) as daily_high,
    MIN(low) as daily_low,
    SUM(tick_count) as daily_ticks
FROM bitcoin_candles_4h
WHERE symbol = 'BTCUSD'
GROUP BY date_trunc('day', time), symbol
ORDER BY day DESC;
```

## Integration with SPtraderB

### Frontend Charts
- Use the same AdaptiveChart component
- Fractal zoom works identically
- No code changes needed

### Backtesting
- Components work with both forex and Bitcoin data
- Same candle structure ensures compatibility
- Strategy YAML files can specify Bitcoin symbols

### Data Ingestion
- Kraken ingester provides real-time Bitcoin data
- Historical data can be imported from various sources
- UPSERT pattern handles duplicate prevention

## Performance Considerations

### Storage Estimates
- **Tick Data**: ~100-200 MB per symbol per day (higher than forex)
- **Candles**: Minimal storage due to aggregation
- **Compression**: Recommended for data older than 30 days

### Query Performance
- Hypertable chunking ensures fast queries
- Index on `(symbol, time)` optimizes lookups
- Continuous aggregates provide pre-computed candles

### Scaling
- Add more symbols without schema changes
- Partition by symbol if needed for very large datasets
- Consider archiving old tick data

## Migration from Forex to Bitcoin

### For Developers
1. Replace table names: `forex_*` → `bitcoin_*`
2. Update symbol names: 'EURUSD' → 'BTCUSD'
3. All other code remains the same

### For Strategies
1. Update symbol in strategy YAML
2. Adjust risk parameters for higher volatility
3. Consider 24/7 trading in timing logic

## Future Enhancements

### Planned Improvements
1. **Real Volume Data**: Add actual traded volume from exchanges
2. **Multiple Exchanges**: Store data from different sources
3. **Order Book Data**: Level 2 market depth information
4. **Trade-by-Trade Data**: Individual trade records

### Potential Schema Additions
```sql
-- Future: Exchange-specific data
ALTER TABLE bitcoin_ticks ADD COLUMN exchange VARCHAR(20);

-- Future: Real volume tracking
ALTER TABLE bitcoin_ticks ADD COLUMN volume NUMERIC(20,8);

-- Future: Trade direction
ALTER TABLE bitcoin_ticks ADD COLUMN trade_direction CHAR(1); -- 'B' or 'S'
```

## Maintenance

### Regular Tasks
1. **Refresh Candles**: Run refresh after new data ingestion
2. **Monitor Growth**: Check table sizes monthly
3. **Compression**: Enable for historical data
4. **Backup**: Include in regular database backups

### Troubleshooting
- **Missing Candles**: Check if refresh was run
- **Duplicate Errors**: UPSERT handles this automatically
- **Performance Issues**: Verify indexes are being used
- **Data Gaps**: Normal for maintenance or exchange downtime