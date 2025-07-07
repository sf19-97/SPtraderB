-- Fix Bitcoin table precision to accommodate prices over 100,000
-- Current NUMERIC(10,5) only allows up to 99,999.99999

-- First, drop the generated columns that depend on bid/ask
ALTER TABLE bitcoin_ticks DROP COLUMN IF EXISTS spread;
ALTER TABLE bitcoin_ticks DROP COLUMN IF EXISTS mid_price;

-- Now we can alter the column types
ALTER TABLE bitcoin_ticks 
    ALTER COLUMN bid TYPE NUMERIC(12,5),
    ALTER COLUMN ask TYPE NUMERIC(12,5);

-- Recreate the generated columns with updated precision
ALTER TABLE bitcoin_ticks 
    ADD COLUMN spread NUMERIC(10,5) GENERATED ALWAYS AS (ask - bid) STORED,
    ADD COLUMN mid_price NUMERIC(12,5) GENERATED ALWAYS AS ((bid + ask) / 2) STORED;

-- Also need to update all the continuous aggregate views
-- They inherit the column types from their source, so we need to refresh them

-- Drop and recreate the continuous aggregates with proper precision
DROP MATERIALIZED VIEW IF EXISTS bitcoin_candles_5m CASCADE;
DROP MATERIALIZED VIEW IF EXISTS bitcoin_candles_15m CASCADE;
DROP MATERIALIZED VIEW IF EXISTS bitcoin_candles_1h CASCADE;
DROP MATERIALIZED VIEW IF EXISTS bitcoin_candles_4h CASCADE;
DROP MATERIALIZED VIEW IF EXISTS bitcoin_candles_12h CASCADE;

-- Recreate 5m candles
CREATE MATERIALIZED VIEW bitcoin_candles_5m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS time,
    symbol,
    FIRST(bid, time) AS open,
    MAX(bid) AS high,
    MIN(bid) AS low,
    LAST(bid, time) AS close,
    SUM(bid_size + ask_size) AS volume,
    COUNT(*) AS tick_count
FROM bitcoin_ticks
GROUP BY time_bucket('5 minutes', time), symbol
WITH NO DATA;

-- Recreate 15m candles (based on 5m)
CREATE MATERIALIZED VIEW bitcoin_candles_15m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('15 minutes', time) AS time,
    symbol,
    FIRST(open, time) AS open,
    MAX(high) AS high,
    MIN(low) AS low,
    LAST(close, time) AS close,
    SUM(volume) AS volume,
    SUM(tick_count) AS tick_count
FROM bitcoin_candles_5m
GROUP BY time_bucket('15 minutes', time), symbol
WITH NO DATA;

-- Recreate 1h candles (based on 15m)
CREATE MATERIALIZED VIEW bitcoin_candles_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS time,
    symbol,
    FIRST(open, time) AS open,
    MAX(high) AS high,
    MIN(low) AS low,
    LAST(close, time) AS close,
    SUM(volume) AS volume,
    SUM(tick_count) AS tick_count
FROM bitcoin_candles_15m
GROUP BY time_bucket('1 hour', time), symbol
WITH NO DATA;

-- Recreate 4h candles (based on 1h)
CREATE MATERIALIZED VIEW bitcoin_candles_4h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('4 hours', time) AS time,
    symbol,
    FIRST(open, time) AS open,
    MAX(high) AS high,
    MIN(low) AS low,
    LAST(close, time) AS close,
    SUM(volume) AS volume,
    SUM(tick_count) AS tick_count
FROM bitcoin_candles_1h
GROUP BY time_bucket('4 hours', time), symbol
WITH NO DATA;

-- Recreate 12h candles (based on 4h)
CREATE MATERIALIZED VIEW bitcoin_candles_12h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('12 hours', time) AS time,
    symbol,
    FIRST(open, time) AS open,
    MAX(high) AS high,
    MIN(low) AS low,
    LAST(close, time) AS close,
    SUM(volume) AS volume,
    SUM(tick_count) AS tick_count
FROM bitcoin_candles_4h
GROUP BY time_bucket('12 hours', time), symbol
WITH NO DATA;

-- Set refresh policies for continuous aggregates
SELECT add_continuous_aggregate_policy('bitcoin_candles_5m',
    start_offset => INTERVAL '1 day',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('bitcoin_candles_15m',
    start_offset => INTERVAL '2 days',
    end_offset => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('bitcoin_candles_1h',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('bitcoin_candles_4h',
    start_offset => INTERVAL '30 days',
    end_offset => INTERVAL '4 hours',
    schedule_interval => INTERVAL '4 hours',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('bitcoin_candles_12h',
    start_offset => INTERVAL '90 days',
    end_offset => INTERVAL '12 hours',
    schedule_interval => INTERVAL '12 hours',
    if_not_exists => TRUE
);

-- Grant permissions
GRANT SELECT ON bitcoin_candles_5m TO PUBLIC;
GRANT SELECT ON bitcoin_candles_15m TO PUBLIC;
GRANT SELECT ON bitcoin_candles_1h TO PUBLIC;
GRANT SELECT ON bitcoin_candles_4h TO PUBLIC;
GRANT SELECT ON bitcoin_candles_12h TO PUBLIC;