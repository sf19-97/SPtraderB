-- Patch for TimescaleDB cascade refresh limitation
-- This creates a custom job system that can call procedures

-- 1. Create a job tracking table
CREATE TABLE IF NOT EXISTS cascade_refresh_jobs (
    job_name TEXT PRIMARY KEY,
    proc_name TEXT NOT NULL,
    schedule_interval INTERVAL NOT NULL,
    last_run TIMESTAMPTZ,
    next_run TIMESTAMPTZ NOT NULL,
    is_running BOOLEAN DEFAULT FALSE,
    enabled BOOLEAN DEFAULT TRUE
);

-- 2. Create a function that can be called by TimescaleDB jobs
-- This function checks if it's time to run cascade refreshes
CREATE OR REPLACE FUNCTION cascade_refresh_scheduler()
RETURNS VOID AS $$
DECLARE
    job RECORD;
BEGIN
    -- Check each job in our custom table
    FOR job IN 
        SELECT * FROM cascade_refresh_jobs 
        WHERE enabled = TRUE 
        AND next_run <= NOW() 
        AND is_running = FALSE
    LOOP
        -- Mark as running
        UPDATE cascade_refresh_jobs 
        SET is_running = TRUE, last_run = NOW()
        WHERE job_name = job.job_name;
        
        -- Execute the procedure using dynamic SQL
        -- This is the key trick - we can execute procedures from functions using EXECUTE
        BEGIN
            EXECUTE format('CALL %I()', job.proc_name);
            
            -- Update next run time
            UPDATE cascade_refresh_jobs 
            SET next_run = NOW() + job.schedule_interval,
                is_running = FALSE
            WHERE job_name = job.job_name;
            
        EXCEPTION WHEN OTHERS THEN
            -- On error, just mark as not running
            UPDATE cascade_refresh_jobs 
            SET is_running = FALSE
            WHERE job_name = job.job_name;
            
            RAISE WARNING 'Cascade job % failed: %', job.job_name, SQLERRM;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 3. Insert our Bitcoin cascade job
INSERT INTO cascade_refresh_jobs (job_name, proc_name, schedule_interval, next_run)
VALUES ('bitcoin_cascade', 'cascade_bitcoin_aggregate_refresh', INTERVAL '30 seconds', NOW())
ON CONFLICT (job_name) DO UPDATE
SET schedule_interval = EXCLUDED.schedule_interval;

-- 4. Create the TimescaleDB job that calls our scheduler
-- This runs every 10 seconds and checks if any cascade jobs need to run
SELECT add_job(
    'cascade_refresh_scheduler',
    schedule_interval => INTERVAL '10 seconds'
);

-- Usage:
-- The scheduler will check every 10 seconds if the cascade needs to run
-- It will execute the procedure using dynamic SQL, bypassing the limitation

-- To disable: UPDATE cascade_refresh_jobs SET enabled = FALSE WHERE job_name = 'bitcoin_cascade';
-- To change interval: UPDATE cascade_refresh_jobs SET schedule_interval = INTERVAL '1 minute' WHERE job_name = 'bitcoin_cascade';