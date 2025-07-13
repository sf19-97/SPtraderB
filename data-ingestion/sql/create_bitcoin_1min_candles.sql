-- Create 1-minute continuous aggregate for Bitcoin
CREATE MATERIALIZED VIEW bitcoin_candles_1m
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 minute', time) AS time,
    'BTCUSD' AS symbol,
    FIRST(bid, time) AS open,
    MAX(bid) AS high,
    MIN(bid) AS low,
    LAST(bid, time) AS close,
    COUNT(*) AS tick_count,
    AVG(bid) AS vwap
FROM bitcoin_ticks
WHERE symbol = 'BTCUSD'
GROUP BY time_bucket('1 minute', time), symbol
WITH NO DATA;

-- Create index on time for better query performance
CREATE INDEX idx_bitcoin_candles_1m_time ON bitcoin_candles_1m (time DESC);

-- Add compression policy (compress data older than 7 days)
SELECT add_compression_policy('bitcoin_candles_1m', INTERVAL '7 days');

-- Refresh the entire history initially
CALL refresh_continuous_aggregate('bitcoin_candles_1m', NULL, NULL);

-- Now update the refresh policies to ensure proper order
-- First, drop existing refresh policies
SELECT job_id, hypertable_name, config 
FROM timescaledb_information.jobs 
WHERE hypertable_name LIKE 'bitcoin_candles%';

-- We'll add these policies with proper dependencies after seeing the current setup