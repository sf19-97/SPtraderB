-- Bitcoin Schema Setup for SPtraderB
-- Based on forex_ticks table structure and continuous aggregates
-- This script creates all necessary tables and views for Bitcoin data

-- Enable TimescaleDB extension if not already enabled
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 1. Create the main Bitcoin ticks table
-- Structure matches forex_ticks exactly to maintain consistency
CREATE TABLE IF NOT EXISTS bitcoin_ticks (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    bid NUMERIC(12,5) NOT NULL,    -- Increased from 10,5 to support BTC prices over 100k
    ask NUMERIC(12,5) NOT NULL,    -- Increased from 10,5 to support BTC prices over 100k
    bid_size INTEGER DEFAULT 0,
    ask_size INTEGER DEFAULT 0,
    -- Generated columns for convenience
    spread NUMERIC(10,5) GENERATED ALWAYS AS (ask - bid) STORED,
    mid_price NUMERIC(12,5) GENERATED ALWAYS AS ((bid + ask) / 2) STORED,
    -- Composite primary key to enable UPSERT operations
    PRIMARY KEY (symbol, time)
);

-- Convert to hypertable for TimescaleDB optimization
SELECT create_hypertable('bitcoin_ticks', 'time', 
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Create index for faster queries by symbol and time
CREATE INDEX IF NOT EXISTS idx_bitcoin_ticks_symbol_time 
ON bitcoin_ticks(symbol, time DESC);

-- 2. Create continuous aggregate for 5-minute candles
-- This is the base level that aggregates directly from ticks
CREATE MATERIALIZED VIEW IF NOT EXISTS bitcoin_candles_5m
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('00:05:00'::interval, time) AS time,
    symbol,
    first(bid, time) AS open,
    max(bid) AS high,
    min(bid) AS low,
    last(bid, time) AS close,
    count(*) AS tick_count
FROM bitcoin_ticks
GROUP BY time_bucket('00:05:00'::interval, time), symbol
WITH NO DATA;

-- 3. Create continuous aggregate for 15-minute candles
-- Aggregates from 5m candles (3 x 5m = 15m)
CREATE MATERIALIZED VIEW IF NOT EXISTS bitcoin_candles_15m
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('00:15:00'::interval, time) AS time,
    symbol,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(tick_count) AS tick_count
FROM bitcoin_candles_5m
GROUP BY time_bucket('00:15:00'::interval, time), symbol
WITH NO DATA;

-- 4. Create continuous aggregate for 1-hour candles
-- Aggregates from 15m candles (4 x 15m = 1h)
CREATE MATERIALIZED VIEW IF NOT EXISTS bitcoin_candles_1h
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('01:00:00'::interval, time) AS time,
    symbol,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(tick_count) AS tick_count
FROM bitcoin_candles_15m
GROUP BY time_bucket('01:00:00'::interval, time), symbol
WITH NO DATA;

-- 5. Create continuous aggregate for 4-hour candles
-- Aggregates from 1h candles (4 x 1h = 4h)
CREATE MATERIALIZED VIEW IF NOT EXISTS bitcoin_candles_4h
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('04:00:00'::interval, time) AS time,
    symbol,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(tick_count) AS tick_count
FROM bitcoin_candles_1h
GROUP BY time_bucket('04:00:00'::interval, time), symbol
WITH NO DATA;

-- 6. Create continuous aggregate for 12-hour candles
-- Aggregates from 4h candles (3 x 4h = 12h)
CREATE MATERIALIZED VIEW IF NOT EXISTS bitcoin_candles_12h
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('12:00:00'::interval, time) AS time,
    symbol,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(tick_count) AS tick_count
FROM bitcoin_candles_4h
GROUP BY time_bucket('12:00:00'::interval, time), symbol
WITH NO DATA;

-- 7. Create metadata table for tracking refresh status
-- This helps with incremental updates and monitoring
CREATE TABLE IF NOT EXISTS bitcoin_candle_refresh_metadata (
    symbol VARCHAR(10) PRIMARY KEY,
    last_refresh_timestamp TIMESTAMPTZ,
    last_tick_timestamp TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Create trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_bitcoin_metadata_updated_at 
BEFORE UPDATE ON bitcoin_candle_refresh_metadata 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. Create refresh policies for automatic updates (optional)
-- Uncomment these if you want automatic refresh every hour
-- SELECT add_continuous_aggregate_policy('bitcoin_candles_5m',
--     start_offset => INTERVAL '2 hours',
--     end_offset => INTERVAL '10 minutes',
--     schedule_interval => INTERVAL '1 hour');

-- 9. Helper function to refresh all Bitcoin candles in order
CREATE OR REPLACE FUNCTION refresh_bitcoin_candles(
    p_symbol VARCHAR(10),
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ
) RETURNS VOID AS $$
BEGIN
    -- Refresh must be done in order (bottom up)
    PERFORM refresh_continuous_aggregate('bitcoin_candles_5m', p_start_time, p_end_time);
    PERFORM refresh_continuous_aggregate('bitcoin_candles_15m', p_start_time, p_end_time);
    PERFORM refresh_continuous_aggregate('bitcoin_candles_1h', p_start_time, p_end_time);
    PERFORM refresh_continuous_aggregate('bitcoin_candles_4h', p_start_time, p_end_time);
    PERFORM refresh_continuous_aggregate('bitcoin_candles_12h', p_start_time, p_end_time);
    
    -- Update metadata
    INSERT INTO bitcoin_candle_refresh_metadata (symbol, last_refresh_timestamp, last_tick_timestamp)
    VALUES (p_symbol, CURRENT_TIMESTAMP, p_end_time)
    ON CONFLICT (symbol) 
    DO UPDATE SET 
        last_refresh_timestamp = CURRENT_TIMESTAMP,
        last_tick_timestamp = EXCLUDED.last_tick_timestamp;
END;
$$ LANGUAGE plpgsql;

-- 10. Create compression policy for old data (optional)
-- Compress data older than 30 days to save space
-- SELECT add_compression_policy('bitcoin_ticks', INTERVAL '30 days');

-- Usage Examples:
-- 
-- Insert sample Bitcoin tick data:
-- INSERT INTO bitcoin_ticks (time, symbol, bid, ask, bid_size, ask_size)
-- VALUES 
--     ('2025-01-06 12:00:00+00', 'BTCUSD', 97500.50, 97501.00, 100, 150),
--     ('2025-01-06 12:00:01+00', 'BTCUSD', 97501.00, 97501.50, 200, 100);
--
-- Refresh candles for a specific date range:
-- SELECT refresh_bitcoin_candles('BTCUSD', '2025-01-01', '2025-01-07');
--
-- Query 1-hour candles:
-- SELECT * FROM bitcoin_candles_1h 
-- WHERE symbol = 'BTCUSD' 
-- AND time >= '2025-01-01' 
-- ORDER BY time DESC 
-- LIMIT 100;

-- Verification queries:
COMMENT ON TABLE bitcoin_ticks IS 'Raw Bitcoin tick data with bid/ask prices and sizes';
COMMENT ON TABLE bitcoin_candle_refresh_metadata IS 'Tracks when continuous aggregates were last refreshed';
COMMENT ON MATERIALIZED VIEW bitcoin_candles_5m IS 'Bitcoin 5-minute OHLC candles aggregated from tick data';
COMMENT ON MATERIALIZED VIEW bitcoin_candles_15m IS 'Bitcoin 15-minute OHLC candles aggregated from 5m candles';
COMMENT ON MATERIALIZED VIEW bitcoin_candles_1h IS 'Bitcoin 1-hour OHLC candles aggregated from 15m candles';
COMMENT ON MATERIALIZED VIEW bitcoin_candles_4h IS 'Bitcoin 4-hour OHLC candles aggregated from 1h candles';
COMMENT ON MATERIALIZED VIEW bitcoin_candles_12h IS 'Bitcoin 12-hour OHLC candles aggregated from 4h candles';