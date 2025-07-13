-- Setup cascading refresh for Bitcoin continuous aggregates
-- This ensures that when lower timeframes refresh, they trigger higher timeframes

-- First, let's create a function that triggers cascading refreshes
CREATE OR REPLACE FUNCTION cascade_bitcoin_aggregate_refresh()
RETURNS void AS $$
BEGIN
    -- Get the current time for consistent refresh
    PERFORM NOW();
    
    -- Refresh in order from lowest to highest timeframe
    -- Each refresh will include data up to the current moment
    
    -- 1. Refresh 1-minute candles first (from raw ticks)
    RAISE NOTICE 'Refreshing bitcoin_candles_1m...';
    CALL refresh_continuous_aggregate('bitcoin_candles_1m', NULL, NULL);
    
    -- 2. Refresh 5-minute candles (from raw ticks)
    RAISE NOTICE 'Refreshing bitcoin_candles_5m...';
    CALL refresh_continuous_aggregate('bitcoin_candles_5m', NULL, NULL);
    
    -- 3. Refresh 15-minute candles (from raw ticks)
    RAISE NOTICE 'Refreshing bitcoin_candles_15m...';
    CALL refresh_continuous_aggregate('bitcoin_candles_15m', NULL, NULL);
    
    -- 4. Refresh 1-hour candles (from raw ticks)
    RAISE NOTICE 'Refreshing bitcoin_candles_1h...';
    CALL refresh_continuous_aggregate('bitcoin_candles_1h', NULL, NULL);
    
    -- 5. Refresh 4-hour candles (from raw ticks)
    RAISE NOTICE 'Refreshing bitcoin_candles_4h...';
    CALL refresh_continuous_aggregate('bitcoin_candles_4h', NULL, NULL);
    
    -- 6. Refresh 12-hour candles (from raw ticks)
    RAISE NOTICE 'Refreshing bitcoin_candles_12h...';
    CALL refresh_continuous_aggregate('bitcoin_candles_12h', NULL, NULL);
    
    RAISE NOTICE 'Cascade refresh complete';
END;
$$ LANGUAGE plpgsql;

-- Create a single job that does cascading refresh
-- First, drop existing individual refresh policies
SELECT remove_continuous_aggregate_policy('bitcoin_candles_1m');
SELECT remove_continuous_aggregate_policy('bitcoin_candles_5m');
SELECT remove_continuous_aggregate_policy('bitcoin_candles_15m');
SELECT remove_continuous_aggregate_policy('bitcoin_candles_1h');
SELECT remove_continuous_aggregate_policy('bitcoin_candles_4h');
SELECT remove_continuous_aggregate_policy('bitcoin_candles_12h');

-- Now create a single cascading refresh job
-- This runs every 30 seconds and refreshes all aggregates in order
SELECT add_job(
    'cascade_bitcoin_aggregate_refresh',
    schedule_interval => INTERVAL '30 seconds',
    initial_start => NOW()
);

-- Alternatively, if you prefer to keep individual policies but with proper timing:
-- We can set them up with staggered schedules to ensure proper ordering

-- Option 2: Staggered individual policies (commented out - use Option 1 OR Option 2)
/*
-- 1m refreshes every 15 seconds (most frequent)
SELECT add_continuous_aggregate_policy('bitcoin_candles_1m',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '0 seconds',
    schedule_interval => INTERVAL '15 seconds'
);

-- 5m refreshes every 30 seconds (15 seconds after 1m)
SELECT add_continuous_aggregate_policy('bitcoin_candles_5m',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '0 seconds',
    schedule_interval => INTERVAL '30 seconds',
    initial_start => NOW() + INTERVAL '15 seconds'
);

-- 15m refreshes every 45 seconds
SELECT add_continuous_aggregate_policy('bitcoin_candles_15m',
    start_offset => INTERVAL '6 hours',
    end_offset => INTERVAL '0 seconds',
    schedule_interval => INTERVAL '45 seconds',
    initial_start => NOW() + INTERVAL '20 seconds'
);

-- 1h refreshes every 2 minutes
SELECT add_continuous_aggregate_policy('bitcoin_candles_1h',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '0 seconds',
    schedule_interval => INTERVAL '2 minutes',
    initial_start => NOW() + INTERVAL '25 seconds'
);

-- 4h refreshes every 5 minutes
SELECT add_continuous_aggregate_policy('bitcoin_candles_4h',
    start_offset => INTERVAL '30 days',
    end_offset => INTERVAL '0 seconds',
    schedule_interval => INTERVAL '5 minutes',
    initial_start => NOW() + INTERVAL '30 seconds'
);

-- 12h refreshes every 10 minutes
SELECT add_continuous_aggregate_policy('bitcoin_candles_12h',
    start_offset => INTERVAL '90 days',
    end_offset => INTERVAL '0 seconds',
    schedule_interval => INTERVAL '10 minutes',
    initial_start => NOW() + INTERVAL '35 seconds'
);
*/

-- View current job status
SELECT job_id, job_name, schedule_interval, next_start
FROM timescaledb_information.jobs
WHERE job_name = 'cascade_bitcoin_aggregate_refresh';