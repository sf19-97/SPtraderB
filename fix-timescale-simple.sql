-- Simple fix for TimescaleCloud
-- Turn off restoring mode to allow inserts
SET timescaledb.restoring = 'off';

-- Check if we have the backup table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'forex_ticks_backup') THEN
        -- Restore data from backup
        INSERT INTO forex_ticks (time, symbol, bid, ask, bid_size, ask_size, source)
        SELECT time, symbol, bid, ask, bid_size, ask_size, source
        FROM forex_ticks_backup
        ON CONFLICT DO NOTHING;

        -- Clean up backup
        DROP TABLE forex_ticks_backup;
    END IF;
END $$;

-- Create simple views that mimic continuous aggregates
-- These will calculate on-the-fly but work immediately

-- 1-minute candles
CREATE OR REPLACE VIEW forex_candles_1m AS
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
GROUP BY 1, 2;

-- 5-minute candles
CREATE OR REPLACE VIEW forex_candles_5m AS
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
GROUP BY 1, 2;

-- 15-minute candles
CREATE OR REPLACE VIEW forex_candles_15m AS
SELECT
    time_bucket('15 minutes', time) AS time,
    symbol,
    FIRST(bid, time) as open,
    MAX(bid) as high,
    MIN(bid) as low,
    LAST(bid, time) as close,
    COUNT(*) as tick_count,
    AVG(bid) as vwap
FROM forex_ticks
GROUP BY 1, 2;

-- 1-hour candles
CREATE OR REPLACE VIEW forex_candles_1h AS
SELECT
    time_bucket('1 hour', time) AS time,
    symbol,
    FIRST(bid, time) as open,
    MAX(bid) as high,
    MIN(bid) as low,
    LAST(bid, time) as close,
    COUNT(*) as tick_count,
    AVG(bid) as vwap
FROM forex_ticks
GROUP BY 1, 2;

-- 4-hour candles
CREATE OR REPLACE VIEW forex_candles_4h AS
SELECT
    time_bucket('4 hours', time) AS time,
    symbol,
    FIRST(bid, time) as open,
    MAX(bid) as high,
    MIN(bid) as low,
    LAST(bid, time) as close,
    COUNT(*) as tick_count,
    AVG(bid) as vwap
FROM forex_ticks
GROUP BY 1, 2;

-- 12-hour candles
CREATE OR REPLACE VIEW forex_candles_12h AS
SELECT
    time_bucket('12 hours', time) AS time,
    symbol,
    FIRST(bid, time) as open,
    MAX(bid) as high,
    MIN(bid) as low,
    LAST(bid, time) as close,
    COUNT(*) as tick_count,
    AVG(bid) as vwap
FROM forex_ticks
GROUP BY 1, 2;

-- Test query
SELECT COUNT(*) as data_rows FROM forex_ticks WHERE symbol = 'EURUSD';
SELECT * FROM forex_candles_1m WHERE symbol = 'EURUSD' ORDER BY time DESC LIMIT 5;

-- Clean up if sss table still exists
DROP TABLE IF EXISTS sss;