-- Fix TimescaleCloud Setup for Forex Data
-- Based on the Bitcoin cascade pattern from BITCOIN_CASCADE_PATTERN.md

-- Step 1: Backup existing data to temp table
CREATE TABLE forex_ticks_backup AS SELECT * FROM forex_ticks;

-- Step 2: Drop and recreate forex_ticks as a proper hypertable
DROP TABLE IF EXISTS forex_ticks CASCADE;

CREATE TABLE forex_ticks (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    bid NUMERIC(10,5) NOT NULL,
    ask NUMERIC(10,5) NOT NULL,
    bid_size INTEGER DEFAULT 0,
    ask_size INTEGER DEFAULT 0,
    spread NUMERIC(8,5) GENERATED ALWAYS AS (ask - bid) STORED,
    mid_price NUMERIC(10,5) GENERATED ALWAYS AS ((bid + ask) / 2) STORED,
    source VARCHAR(50)
);

-- Convert to hypertable BEFORE adding data
SELECT create_hypertable('forex_ticks', 'time', chunk_time_interval => INTERVAL '1 day');

-- Create index for performance
CREATE INDEX forex_ticks_symbol_time_idx ON forex_ticks(symbol, time DESC);

-- Step 3: Restore data
INSERT INTO forex_ticks (time, symbol, bid, ask, bid_size, ask_size, source)
SELECT time, symbol, bid, ask, bid_size, ask_size, source
FROM forex_ticks_backup;

-- Step 4: Create continuous aggregates with CASCADE pattern
-- Following the Bitcoin pattern exactly

-- 1-minute candles (from raw ticks)
CREATE MATERIALIZED VIEW forex_candles_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) AS time,
    symbol,
    FIRST(bid, time) as open,
    MAX(bid) as high,
    MIN(bid) as low,
    LAST(bid, time) as close,
    COUNT(*) as tick_count,
    AVG(bid) as vwap
FROM forex_ticks
GROUP BY 1, 2
WITH NO DATA;

-- 5-minute candles (from raw ticks)
CREATE MATERIALIZED VIEW forex_candles_5m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS time,
    symbol,
    FIRST(bid, time) as open,
    MAX(bid) as high,
    MIN(bid) as low,
    LAST(bid, time) as close,
    COUNT(*) as tick_count,
    AVG(bid) as vwap
FROM forex_ticks
GROUP BY 1, 2
WITH NO DATA;

-- 15-minute candles (from 5m candles)
CREATE MATERIALIZED VIEW forex_candles_15m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('15 minutes', time) AS time,
    symbol,
    FIRST(open, time) as open,
    MAX(high) as high,
    MIN(low) as low,
    LAST(close, time) as close,
    SUM(tick_count) as tick_count,
    AVG(vwap) as vwap
FROM forex_candles_5m
GROUP BY 1, 2
WITH NO DATA;

-- 1-hour candles (from 15m candles)
CREATE MATERIALIZED VIEW forex_candles_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS time,
    symbol,
    FIRST(open, time) as open,
    MAX(high) as high,
    MIN(low) as low,
    LAST(close, time) as close,
    SUM(tick_count) as tick_count,
    AVG(vwap) as vwap
FROM forex_candles_15m
GROUP BY 1, 2
WITH NO DATA;

-- 4-hour candles (from 1h candles)
CREATE MATERIALIZED VIEW forex_candles_4h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('4 hours', time) AS time,
    symbol,
    FIRST(open, time) as open,
    MAX(high) as high,
    MIN(low) as low,
    LAST(close, time) as close,
    SUM(tick_count) as tick_count,
    AVG(vwap) as vwap
FROM forex_candles_1h
GROUP BY 1, 2
WITH NO DATA;

-- 12-hour candles (from 4h candles)
CREATE MATERIALIZED VIEW forex_candles_12h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('12 hours', time) AS time,
    symbol,
    FIRST(open, time) as open,
    MAX(high) as high,
    MIN(low) as low,
    LAST(close, time) as close,
    SUM(tick_count) as tick_count,
    AVG(vwap) as vwap
FROM forex_candles_4h
GROUP BY 1, 2
WITH NO DATA;

-- Step 5: Create cascade refresh procedure (following Bitcoin pattern)
CREATE OR REPLACE PROCEDURE cascade_forex_aggregate_refresh()
LANGUAGE plpgsql
AS $$
BEGIN
    -- Refresh in order from lowest to highest timeframe
    RAISE NOTICE 'Starting cascade refresh at %', NOW();

    -- 1m candles (from raw ticks)
    RAISE NOTICE 'Refreshing 1m candles...';
    CALL refresh_continuous_aggregate('forex_candles_1m', NULL, NULL);

    -- 5m candles (from raw ticks)
    RAISE NOTICE 'Refreshing 5m candles...';
    CALL refresh_continuous_aggregate('forex_candles_5m', NULL, NULL);

    -- 15m candles (from 5m)
    RAISE NOTICE 'Refreshing 15m candles...';
    CALL refresh_continuous_aggregate('forex_candles_15m', NULL, NULL);

    -- 1h candles (from 15m)
    RAISE NOTICE 'Refreshing 1h candles...';
    CALL refresh_continuous_aggregate('forex_candles_1h', NULL, NULL);

    -- 4h candles (from 1h)
    RAISE NOTICE 'Refreshing 4h candles...';
    CALL refresh_continuous_aggregate('forex_candles_4h', NULL, NULL);

    -- 12h candles (from 4h)
    RAISE NOTICE 'Refreshing 12h candles...';
    CALL refresh_continuous_aggregate('forex_candles_12h', NULL, NULL);

    RAISE NOTICE 'Cascade refresh complete at %', NOW();
END;
$$;

-- Step 6: Initial population of all aggregates
-- This will take a while but only needs to run once
CALL cascade_forex_aggregate_refresh();

-- Step 7: Clean up
DROP TABLE forex_ticks_backup;
DROP TABLE IF EXISTS sss;

-- Step 8: Create refresh policies for real-time updates
SELECT add_continuous_aggregate_policy('forex_candles_1m',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

SELECT add_continuous_aggregate_policy('forex_candles_5m',
    start_offset => INTERVAL '4 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '5 minutes');

SELECT add_continuous_aggregate_policy('forex_candles_15m',
    start_offset => INTERVAL '8 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '15 minutes');

SELECT add_continuous_aggregate_policy('forex_candles_1h',
    start_offset => INTERVAL '24 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('forex_candles_4h',
    start_offset => INTERVAL '48 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '4 hours');

SELECT add_continuous_aggregate_policy('forex_candles_12h',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '12 hours');

-- Done! Test with:
-- SELECT * FROM forex_candles_1m WHERE symbol = 'EURUSD' ORDER BY time DESC LIMIT 10;