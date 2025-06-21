# SPtraderB Database Schema Documentation

## Overview
The SPtraderB project uses PostgreSQL with TimescaleDB extension to store forex tick data and generate candlestick data through a cascade of continuous aggregates.

## Database Tables

### forex_ticks (Base Table)
Stores raw tick data from Dukascopy:
- `time` (timestamptz): Tick timestamp
- `symbol` (varchar(10)): Currency pair (e.g., EURUSD, USDJPY)
- `bid` (numeric(10,5)): Bid price
- `ask` (numeric(10,5)): Ask price
- `bid_size` (integer): Bid volume in units (default: 0)
- `ask_size` (integer): Ask volume in units (default: 0)
- `spread` (numeric(8,5)): Generated column = ask - bid
- `mid_price` (numeric(10,5)): Generated column = (bid + ask) / 2

### candle_refresh_metadata
Tracks the last refresh timestamp for continuous aggregates:
- `symbol`: Currency pair
- `last_refresh_timestamp`: Last time candles were refreshed
- `last_tick_timestamp`: Timestamp of the newest tick when last refreshed
- `updated_at`: Last update time

## Continuous Aggregates (Candle Views)

### Cascade Architecture
The candles are generated in a cascade:
```
forex_ticks → forex_candles_5m → forex_candles_15m → forex_candles_1h → forex_candles_4h → forex_candles_12h
```

### forex_candles_5m
Base candle aggregation from tick data:
```sql
SELECT time_bucket('00:05:00'::interval, time) AS time,
    symbol,
    first(bid, time) AS open,    -- First bid price in period
    max(bid) AS high,             -- Highest bid price
    min(bid) AS low,              -- Lowest bid price
    last(bid, time) AS close,     -- Last bid price in period
    count(*) AS tick_count        -- Number of ticks (used as volume)
FROM forex_ticks
GROUP BY time_bucket('00:05:00'::interval, time), symbol;
```

### forex_candles_15m
Aggregates from 5m candles (3 x 5m = 15m):
```sql
SELECT time_bucket('00:15:00'::interval, time) AS time,
    symbol,
    first(open, time) AS open,    -- Open from first 5m candle
    max(high) AS high,            -- Max of all 5m highs
    min(low) AS low,              -- Min of all 5m lows
    last(close, time) AS close,   -- Close from last 5m candle
    sum(tick_count) AS tick_count -- Sum of tick counts
FROM forex_candles_5m
GROUP BY time_bucket('00:15:00'::interval, time), symbol;
```

### forex_candles_1h
Aggregates from 15m candles (4 x 15m = 1h):
```sql
SELECT time_bucket('01:00:00'::interval, time) AS time,
    symbol,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(tick_count) AS tick_count
FROM forex_candles_15m
GROUP BY time_bucket('01:00:00'::interval, time), symbol;
```

### forex_candles_4h
Aggregates from 1h candles (4 x 1h = 4h):
```sql
SELECT time_bucket('04:00:00'::interval, time) AS time,
    symbol,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(tick_count) AS tick_count
FROM forex_candles_1h
GROUP BY time_bucket('04:00:00'::interval, time), symbol;
```

### forex_candles_12h
Aggregates from 4h candles (3 x 4h = 12h):
```sql
SELECT time_bucket('12:00:00'::interval, time) AS time,
    symbol,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(tick_count) AS tick_count
FROM forex_candles_4h
GROUP BY time_bucket('12:00:00'::interval, time), symbol;
```

## Important Notes

### Volume Field Semantics
**CRITICAL**: The `volume` field in candles represents **tick count**, not traditional traded volume:
- In the application code, `tick_count` is aliased as `volume`
- This represents the number of price updates (ticks) in the time period
- It does NOT represent the actual traded volume (bid_size/ask_size are stored but not aggregated)
- Each higher timeframe's tick_count is the sum of its constituent lower timeframe tick_counts

### Price Data
- All candles use **bid prices only** for OHLC calculations
- This is consistent across all timeframes
- Ask prices are stored in ticks but not used in candle generation

### Aggregation Rules
1. **Open**: First value in the period (using TimescaleDB's `first()` function ordered by time)
2. **High**: Maximum value in the period
3. **Low**: Minimum value in the period
4. **Close**: Last value in the period (using TimescaleDB's `last()` function ordered by time)
5. **Volume (tick_count)**: Sum of tick counts from lower timeframe

### Refresh Process
- Candles are refreshed using `refresh_continuous_aggregate()` stored procedure
- Large date ranges (>60 days) are processed in monthly chunks to avoid errors
- The cascade means refreshing must happen in order: 5m → 15m → 1h → 4h → 12h
- Metadata tracks the last refresh to enable incremental updates

### Data Precision
- EUR pairs: 5 decimal places (prices divided by 100,000 during ingestion)
- JPY pairs: 3 decimal places (prices divided by 1,000 during ingestion)
- All prices stored as NUMERIC(10,5) for consistency