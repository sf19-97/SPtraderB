# Automatic Candle Refresh with TimescaleDB Policies

## Overview
This document describes how to set up automatic candle generation using TimescaleDB's built-in continuous aggregate refresh policies. Once configured, the database will automatically process tick data into candles without any external scripts or services.

## Why Database-Level Automation?

### Current Manual Process
```bash
# Currently you must manually run:
CALL refresh_continuous_aggregate('forex_candles_5m', start_time, end_time);
CALL refresh_continuous_aggregate('forex_candles_15m', start_time, end_time);
# ... etc for each timeframe
```

### Benefits of Automatic Policies
1. **No External Dependencies** - Runs entirely within PostgreSQL
2. **Survives Restarts** - Policies persist through database/system restarts
3. **Efficient** - Only processes new data since last refresh
4. **Self-Healing** - Automatically catches up after downtime
5. **Zero Maintenance** - Set once and forget

## Understanding the Cascade Architecture

Your continuous aggregates form a dependency chain:

```
forex_ticks (raw tick data)
    ↓ (aggregated by time_bucket)
forex_candles_5m 
    ↓ (every 3 candles)
forex_candles_15m
    ↓ (every 4 candles)
forex_candles_1h
    ↓ (every 4 candles)
forex_candles_4h
    ↓ (every 3 candles)
forex_candles_12h
```

**Critical Rule**: Each level MUST be refreshed AFTER its source data is ready.

## Refresh Policy Design

### Timing Strategy

| Timeframe | Refresh Every | Start Offset | End Offset | Why This Frequency? |
|-----------|--------------|--------------|------------|---------------------|
| 5m | 5 minutes | 3 hours | 1 minute | Base layer, needs freshest data |
| 15m | 15 minutes | 3 hours | 1 minute | Waits for three 5m candles |
| 1h | 30 minutes | 3 hours | 1 minute | Runs 2x per hour for reliability |
| 4h | 2 hours | 6 hours | 1 minute | Runs 2x per 4h period |
| 12h | 4 hours | 24 hours | 1 minute | Runs 3x per 12h period |

### Offset Explanation
- **Start Offset**: How far back to look for new data (3 hours covers Dukascopy's 1-2 hour delay)
- **End Offset**: How recent data to include (1 minute avoids incomplete current candles)

## Setup Instructions

### Step 1: Check Current State
```sql
-- Check if any policies exist
SELECT job_id, application_name, schedule_interval, config 
FROM timescaledb_information.jobs
WHERE application_name LIKE '%continuous_aggregate_policy%';
```

### Step 2: Add Refresh Policies
Execute these SQL commands in order:

```sql
-- 1. Base layer: 5-minute candles from tick data
SELECT add_continuous_aggregate_policy('forex_candles_5m',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => true
);

-- 2. 15-minute candles from 5-minute data
-- Initial start offset by 2 minutes to ensure 5m data is ready
SELECT add_continuous_aggregate_policy('forex_candles_15m',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '15 minutes',
    initial_start => now() + INTERVAL '2 minutes',
    if_not_exists => true
);

-- 3. 1-hour candles from 15-minute data
-- Offset by 5 minutes to ensure 15m data is ready
SELECT add_continuous_aggregate_policy('forex_candles_1h',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '30 minutes',
    initial_start => now() + INTERVAL '5 minutes',
    if_not_exists => true
);

-- 4. 4-hour candles from 1-hour data
-- Offset by 10 minutes to ensure 1h data is ready
SELECT add_continuous_aggregate_policy('forex_candles_4h',
    start_offset => INTERVAL '6 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '2 hours',
    initial_start => now() + INTERVAL '10 minutes',
    if_not_exists => true
);

-- 5. 12-hour candles from 4-hour data
-- Offset by 15 minutes to ensure 4h data is ready
SELECT add_continuous_aggregate_policy('forex_candles_12h',
    start_offset => INTERVAL '24 hours',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '4 hours',
    initial_start => now() + INTERVAL '15 minutes',
    if_not_exists => true
);
```

### Step 3: Verify Policy Creation
```sql
-- List all continuous aggregate policies
SELECT 
    job_id,
    application_name,
    schedule_interval,
    config,
    scheduled,
    next_start
FROM timescaledb_information.jobs
WHERE application_name LIKE '%continuous_aggregate_policy%'
ORDER BY job_id;
```

## Example Timeline

Here's what happens when new tick data arrives:

```
13:50 - Auto-ingester downloads tick data for 12:00-13:00
14:00 - 5m policy runs → creates 5m candles for 11:00-13:59
14:02 - (5m candles are ready)
14:15 - 15m policy runs → creates 15m candles from new 5m data
14:17 - (15m candles are ready)
14:30 - 1h policy runs → creates 1h candles from new 15m data
14:32 - (1h candles are ready)
16:00 - 4h policy runs → creates 4h candles from new 1h data
16:00 - 12h policy might run → creates 12h candles if scheduled
```

## Monitoring and Troubleshooting

### Check Policy Execution History
```sql
-- View recent policy runs
SELECT 
    job_id,
    start_time,
    finish_time,
    finish_time - start_time as duration,
    successful
FROM timescaledb_information.job_stats
WHERE job_id IN (
    SELECT job_id 
    FROM timescaledb_information.jobs 
    WHERE application_name LIKE '%continuous_aggregate_policy%'
)
ORDER BY start_time DESC
LIMIT 20;
```

### Check Refresh Status
```sql
-- See how up-to-date each candle table is
SELECT 
    '5m' as timeframe,
    MAX(time) as latest_candle,
    NOW() - MAX(time) as lag
FROM forex_candles_5m
WHERE symbol = 'EURUSD'
UNION ALL
SELECT '15m', MAX(time), NOW() - MAX(time)
FROM forex_candles_15m
WHERE symbol = 'EURUSD'
UNION ALL
SELECT '1h', MAX(time), NOW() - MAX(time)
FROM forex_candles_1h
WHERE symbol = 'EURUSD'
-- Continue for other timeframes
ORDER BY timeframe;
```

### Manual Policy Execution
```sql
-- Force immediate execution of a policy
SELECT run_job(job_id) 
FROM timescaledb_information.jobs 
WHERE application_name = 'Refresh Continuous Aggregate Policy [forex_candles_5m]';
```

### Disable/Enable Policies
```sql
-- Temporarily disable a policy
SELECT alter_job(job_id, scheduled => false)
FROM timescaledb_information.jobs
WHERE application_name = 'Refresh Continuous Aggregate Policy [forex_candles_5m]';

-- Re-enable a policy
SELECT alter_job(job_id, scheduled => true)
FROM timescaledb_information.jobs
WHERE application_name = 'Refresh Continuous Aggregate Policy [forex_candles_5m]';
```

### Remove Policies
```sql
-- Remove a specific policy
SELECT remove_continuous_aggregate_policy('forex_candles_5m');

-- Remove all policies (careful!)
SELECT remove_continuous_aggregate_policy(view_name)
FROM timescaledb_information.continuous_aggregates
WHERE view_name LIKE 'forex_candles_%';
```

## Integration with Data Pipeline

### Complete Automated Flow
1. **AWS Lambda** (every 5 min) → Checks Dukascopy availability
2. **Auto-Ingester** (every 15 min) → Downloads new tick data
3. **TimescaleDB Policies** (5-240 min) → Automatically creates candles
4. **Your App** → Queries ready-to-use candle data

### No Manual Intervention Required
- Tick ingestion: Handled by auto-ingester
- Candle generation: Handled by TimescaleDB policies
- Data freshness: Maximum 15 minutes behind real-time

## Performance Considerations

### Resource Usage
- Each refresh job uses one database connection
- CPU usage is minimal (aggregation is efficient)
- I/O increases during refresh (reading ticks, writing candles)
- Typical refresh takes 1-10 seconds per timeframe

### Optimization Tips
1. **Stagger Initial Start Times** - Prevents all policies running simultaneously
2. **Monitor Lag** - If candles fall behind, reduce refresh interval
3. **Index Health** - Ensure indexes on (symbol, time) are maintained
4. **Chunk Size** - Default 7-day chunks are optimal for this workload

## Common Issues and Solutions

### Issue: Candles Not Updating
**Check:**
1. Are policies scheduled? `SELECT * FROM timescaledb_information.jobs`
2. Is tick data recent? `SELECT MAX(time) FROM forex_ticks`
3. Check job errors: `SELECT * FROM timescaledb_information.job_stats WHERE successful = false`

### Issue: Policies Running Too Slowly
**Solutions:**
1. Increase `start_offset` to reduce data range
2. Run `VACUUM ANALYZE` on continuous aggregates
3. Check for lock contention during refresh

### Issue: Cascade Dependencies Breaking
**Fix:**
Ensure refresh times are staggered (use `initial_start` parameter)

## Best Practices

1. **Set Up Monitoring** - Create alerts for failed jobs
2. **Regular Maintenance** - Run `VACUUM ANALYZE` weekly
3. **Document Changes** - Log any policy modifications
4. **Test Recovery** - Verify policies restart after database restart
5. **Keep Logs** - Monitor `job_stats` table for performance trends

## Conclusion

With these policies in place, your candle generation is fully automated:
- No external scripts needed
- Survives system restarts
- Self-healing after outages
- Efficient and scalable

The combination of automated tick ingestion and TimescaleDB refresh policies creates a robust, hands-off data pipeline that keeps your trading data current with minimal operational overhead.