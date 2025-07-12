-- Setup Bitcoin continuous aggregate refresh policies with proper ordering
-- The order must be: 1m → 5m → 15m → 1h → 4h → 12h

-- First, add refresh policy for the new 1-minute aggregate
SELECT add_continuous_aggregate_policy('bitcoin_candles_1m',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '0 seconds',
    schedule_interval => INTERVAL '15 seconds'
);

-- Now add compression policy for 1-minute candles
SELECT add_compression_policy('bitcoin_candles_1m', INTERVAL '7 days');

-- Check current job IDs and their next scheduled times
SELECT 
    j.job_id,
    j.hypertable_name,
    j.schedule_interval,
    j.next_start,
    c.config
FROM timescaledb_information.jobs j
JOIN LATERAL (
    SELECT jsonb_build_object(
        'start_offset', config->>'start_offset',
        'end_offset', config->>'end_offset'
    ) as config
) c ON true
WHERE j.hypertable_name LIKE 'bitcoin_candles%'
ORDER BY 
    CASE j.hypertable_name
        WHEN 'bitcoin_candles_1m' THEN 1
        WHEN 'bitcoin_candles_5m' THEN 2
        WHEN 'bitcoin_candles_15m' THEN 3
        WHEN 'bitcoin_candles_1h' THEN 4
        WHEN 'bitcoin_candles_4h' THEN 5
        WHEN 'bitcoin_candles_12h' THEN 6
    END;

-- Update refresh intervals to ensure proper cascade timing
-- 1m refreshes every 15 seconds
-- 5m refreshes every 30 seconds (after 1m completes)
-- 15m refreshes every 30 seconds (after 5m completes)
-- 1h refreshes every 15 minutes (after 15m completes)
-- 4h refreshes every 30 minutes (after 1h completes)
-- 12h refreshes every 1 hour (after 4h completes)

-- The existing policies already look good, just need to verify the 1m is added properly