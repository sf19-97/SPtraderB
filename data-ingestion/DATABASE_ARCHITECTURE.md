# Database Architecture Documentation

## Overview
The SPtraderB project uses PostgreSQL with TimescaleDB extension for storing and processing forex tick data. The architecture implements a hierarchical continuous aggregate system that automatically converts raw tick data into multiple timeframe candles.

## Technology Stack
- **PostgreSQL 17**: Primary database
- **TimescaleDB 2.20.2**: Time-series optimization and continuous aggregates
- **Connection**: `postgresql://postgres@localhost:5432/forex_trading`
- **Max Connections**: 10 (connection pooling)

## Database Schema

### 1. Raw Tick Data Table: `forex_ticks`
Stores every price change from Dukascopy.

**Structure:**
```sql
- time: TIMESTAMPTZ (microsecond precision)
- symbol: VARCHAR(10) 
- bid: DECIMAL(10,5)
- ask: DECIMAL(10,5)
- bid_size: INTEGER
- ask_size: INTEGER
- spread: DECIMAL (generated column: ask - bid)
```

**Key Constraints:**
- Primary Key: `(symbol, time)`
- This enables UPSERT operations preventing duplicates

**Data Characteristics:**
- ~50-100k ticks per symbol per day
- 5 decimal precision for EUR pairs
- 3 decimal precision for JPY pairs
- Data arrives with 1-2 hour delay from Dukascopy

### 2. Continuous Aggregates (Candles)

TimescaleDB automatically generates candles from tick data using a hierarchical approach:

```
forex_ticks (raw) 
    ↓
forex_candles_5m (from ticks)
    ↓
forex_candles_15m (from 5m candles)
    ↓
forex_candles_1h (from 15m candles)
    ↓
forex_candles_4h (from 1h candles)
    ↓
forex_candles_12h (from 4h candles)
```

**Candle Structure (all timeframes):**
```sql
- time: TIMESTAMPTZ
- symbol: VARCHAR(10)
- open: NUMERIC (first price in period)
- high: NUMERIC (highest price in period)
- low: NUMERIC (lowest price in period)
- close: NUMERIC (last price in period)
- tick_count: NUMERIC (number of ticks, represents activity)
```

**Important Notes:**
- Candles are built from BID prices only
- `tick_count` represents market activity (not traded volume)
- Each level aggregates from the level below for efficiency

### 3. Metadata Tables

**candle_refresh_metadata**
Tracks when continuous aggregates were last refreshed:
```sql
- symbol: VARCHAR(10)
- last_refresh_timestamp: TIMESTAMPTZ
- last_tick_timestamp: TIMESTAMPTZ
```

## Data Flow

### 1. Ingestion Pipeline
```
Dukascopy API → Python Ingester → forex_ticks → Continuous Aggregates
```

1. **Data Source**: Dukascopy provides tick data as compressed .bi5 files
2. **Ingestion**: `dukascopy_ingester.py` downloads and decompresses data
3. **Storage**: UPSERT into forex_ticks (handles duplicates gracefully)
4. **Processing**: Manual refresh triggers candle generation

### 2. Candle Generation Process
```sql
-- Refresh must be done in order (bottom up):
CALL refresh_continuous_aggregate('forex_candles_5m', start_time, end_time);
CALL refresh_continuous_aggregate('forex_candles_15m', start_time, end_time);
CALL refresh_continuous_aggregate('forex_candles_1h', start_time, end_time);
CALL refresh_continuous_aggregate('forex_candles_4h', start_time, end_time);
CALL refresh_continuous_aggregate('forex_candles_12h', start_time, end_time);
```

### 3. Query Optimization
- All tables are hypertables (TimescaleDB feature)
- Automatic chunking by time (default: 7 days)
- Indexes on (symbol, time) for fast lookups
- Continuous aggregates are materialized views (pre-computed)

## Current Data Status

### Available Symbols
- **EURUSD**: Full historical data from 2023-01-07
- **USDJPY**: Partial data (needs backfill)

### Update Frequency
- **Tick Data**: Available with 1-2 hour delay
- **Auto Ingestion**: Runs every 15 minutes via cloud monitor
- **Candle Refresh**: Currently manual (needs automation)

## Maintenance Operations

### Check Data Availability
```sql
-- Latest tick data per symbol
SELECT symbol, MAX(time) as latest_tick, COUNT(*) as total_ticks
FROM forex_ticks 
GROUP BY symbol;

-- Latest candles per timeframe
SELECT '1h' as timeframe, symbol, MAX(time) as latest
FROM forex_candles_1h
GROUP BY symbol;
```

### Manual Candle Refresh
```sql
-- Refresh candles for specific date range
CALL refresh_continuous_aggregate('forex_candles_5m', '2025-01-01', '2025-01-31');
-- Then cascade up through 15m, 1h, 4h, 12h
```

### Data Cleanup (if needed)
```sql
-- Delete data for specific symbol/date range
DELETE FROM forex_ticks 
WHERE symbol = 'EURUSD' 
AND time >= '2025-01-01' 
AND time < '2025-02-01';
```

## Performance Characteristics

### Storage
- **Tick Data**: ~30-50 MB per symbol per day
- **Compression**: TimescaleDB automatic compression available
- **Current Size**: ~40 GB (mainly EURUSD historical data)

### Query Performance
- **Tick queries**: Sub-second for day ranges
- **Candle queries**: Milliseconds (pre-aggregated)
- **Aggregation refresh**: ~1-2 seconds per day per timeframe

### Connection Pooling
- **Backend Pool**: 10 connections max
- **Pre-warming**: Metadata queries cached on startup
- **Candle Cache**: 10-minute TTL in application layer

## Integration Points

### 1. Application Backend (Rust/Tauri)
- Queries candles for chart display
- Manages connection pool
- Implements caching layer
- Handles real-time updates (future)

### 2. Data Ingestion (Python)
- `dukascopy_ingester.py`: Manual/automated tick ingestion
- `auto-ingester/monitor.py`: Automated monitoring and ingestion
- Respects UPSERT semantics

### 3. Trading Components (Python)
- Backtesting reads historical candles
- Indicators calculate from candle data
- Strategies process aggregated data

## Future Enhancements

### Planned Improvements
1. **Automatic Candle Refresh**: Add TimescaleDB policies
2. **Compression**: Enable for older tick data
3. **Partitioning**: Consider partitioning by symbol for scale
4. **Real-time Integration**: OANDA feed for recent data

### Scaling Considerations
- Current design handles millions of ticks efficiently
- Continuous aggregates scale linearly with data
- Can add read replicas if needed
- Archive old tick data to cold storage

## Backup & Recovery

### Backup Strategy
```bash
# Full backup
pg_dump -h localhost -U postgres -d forex_trading > forex_trading_backup.sql

# Data only (faster)
pg_dump -h localhost -U postgres -d forex_trading --data-only > forex_data_backup.sql
```

### Recovery
```bash
# Restore from backup
psql -h localhost -U postgres -d forex_trading < forex_trading_backup.sql
```

## Important Notes

1. **Data Integrity**: UPSERT on (symbol, time) prevents duplicates
2. **Timezone**: All timestamps are stored in UTC
3. **Precision**: Prices stored as DECIMAL for accuracy
4. **No Volume**: Forex tick data doesn't include traded volume
5. **Continuous Aggregates**: Must refresh in order (5m → 15m → 1h → 4h → 12h)