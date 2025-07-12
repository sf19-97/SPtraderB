-- Fix the cascading refresh to use the proper TimescaleDB function
DROP FUNCTION IF EXISTS cascade_bitcoin_aggregate_refresh();

-- Create a stored procedure instead of a function
CREATE OR REPLACE PROCEDURE cascade_bitcoin_aggregate_refresh()
LANGUAGE plpgsql
AS $$
BEGIN
    -- Refresh in order from lowest to highest timeframe
    RAISE NOTICE 'Starting cascade refresh at %', NOW();
    
    -- 1m candles
    RAISE NOTICE 'Refreshing 1m candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_1m', NULL, NULL);
    
    -- 5m candles  
    RAISE NOTICE 'Refreshing 5m candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_5m', NULL, NULL);
    
    -- 15m candles
    RAISE NOTICE 'Refreshing 15m candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_15m', NULL, NULL);
    
    -- 1h candles
    RAISE NOTICE 'Refreshing 1h candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_1h', NULL, NULL);
    
    -- 4h candles
    RAISE NOTICE 'Refreshing 4h candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_4h', NULL, NULL);
    
    -- 12h candles
    RAISE NOTICE 'Refreshing 12h candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_12h', NULL, NULL);
    
    RAISE NOTICE 'Cascade refresh complete at %', NOW();
END;
$$;

-- Remove the job we just created
SELECT delete_job(1019);

-- Create individual policies with proper timing and dependencies
-- The key is using negative end_offset to ensure we get the latest data

-- 1m: Refresh every 15 seconds, include data up to 5 seconds ago
SELECT add_continuous_aggregate_policy('bitcoin_candles_1m',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '-5 seconds',  -- Negative offset includes recent data
    schedule_interval => INTERVAL '15 seconds'
);

-- 5m: Refresh every 30 seconds, 5 seconds after 1m
SELECT add_continuous_aggregate_policy('bitcoin_candles_5m',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '-10 seconds',
    schedule_interval => INTERVAL '30 seconds',
    initial_start => NOW() + INTERVAL '5 seconds'
);

-- 15m: Refresh every 60 seconds, 10 seconds after 5m  
SELECT add_continuous_aggregate_policy('bitcoin_candles_15m',
    start_offset => INTERVAL '6 hours',
    end_offset => INTERVAL '-15 seconds',
    schedule_interval => INTERVAL '60 seconds',
    initial_start => NOW() + INTERVAL '10 seconds'
);

-- 1h: Refresh every 2 minutes, 15 seconds after 15m
SELECT add_continuous_aggregate_policy('bitcoin_candles_1h',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '-20 seconds',
    schedule_interval => INTERVAL '2 minutes',
    initial_start => NOW() + INTERVAL '15 seconds'
);

-- 4h: Refresh every 5 minutes, 20 seconds after 1h
SELECT add_continuous_aggregate_policy('bitcoin_candles_4h',
    start_offset => INTERVAL '30 days',
    end_offset => INTERVAL '-30 seconds',
    schedule_interval => INTERVAL '5 minutes',
    initial_start => NOW() + INTERVAL '20 seconds'
);

-- 12h: Refresh every 10 minutes, 25 seconds after 4h
SELECT add_continuous_aggregate_policy('bitcoin_candles_12h',
    start_offset => INTERVAL '90 days',
    end_offset => INTERVAL '-60 seconds',
    schedule_interval => INTERVAL '10 minutes',
    initial_start => NOW() + INTERVAL '25 seconds'
);

-- Show the new refresh policies
SELECT 
    job_id,
    hypertable_name,
    schedule_interval,
    config->>'end_offset' as end_offset,
    config->>'start_offset' as start_offset,
    next_start
FROM timescaledb_information.jobs 
WHERE hypertable_name LIKE 'bitcoin_candles%'
ORDER BY 
    CASE hypertable_name
        WHEN 'bitcoin_candles_1m' THEN 1
        WHEN 'bitcoin_candles_5m' THEN 2
        WHEN 'bitcoin_candles_15m' THEN 3
        WHEN 'bitcoin_candles_1h' THEN 4
        WHEN 'bitcoin_candles_4h' THEN 5
        WHEN 'bitcoin_candles_12h' THEN 6
    END;