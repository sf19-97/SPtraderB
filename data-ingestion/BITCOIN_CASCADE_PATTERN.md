# Bitcoin Real-time Pipeline - THE WORKING PATTERN

## Overview
This documents the EXACT pattern that works for real-time data ingestion with hierarchical continuous aggregates in TimescaleDB. This pattern runs 24/7 and maintains perfect cascade ordering. This is the result of extensive trial and error to work around TimescaleDB limitations.

## Prerequisites
- PostgreSQL 17 with TimescaleDB extension
- Python 3.x with packages: `websockets`, `psycopg2-binary`, `asyncio`
- macOS with launchd (or adapt for systemd/cron on Linux)
- PostgreSQL installed at `/opt/homebrew/opt/postgresql@17/bin/psql` (update path if different)

## The Problem We Solved

### TimescaleDB's Catch-22
1. **Jobs can only call functions**: `add_job()` requires a FUNCTION, not a PROCEDURE
2. **Refresh requires procedures**: `refresh_continuous_aggregate()` can ONLY be called from PROCEDURES
3. **Functions run in transactions**: Can't call procedures that manage their own transactions
4. **Result**: It's IMPOSSIBLE to create a cascade refresh job within TimescaleDB

### Failed Attempts (Don't Do These!)
1. **Individual policies with staggered starts**: They drift out of sync over time
2. **Wrapper functions**: `ERROR: refresh_continuous_aggregate() cannot be executed from a function`
3. **Dynamic SQL EXECUTE**: Still runs inside function's transaction
4. **Custom job table with scheduler**: Transaction blocks prevent procedure execution

### The Hierarchical Aggregate Challenge
With hierarchical aggregates, timing is CRITICAL:
- 15m is built from 5m data
- If 15m refreshes before 5m updates, it uses stale data
- Individual policies refresh independently = data inconsistency

## The Solution: External Cascade Scheduler

### Architecture
```
Kraken WebSocket → Python Ingester → PostgreSQL → Cascade Refresh → Continuous Aggregates
     (ticks)         (launchd)        (ticks)      (launchd)         (1m,5m,15m,1h,4h,12h)
```

### Component 1: Direct Bitcoin Ingester
**File**: `live/kraken/direct-bitcoin-ingester.py`

Key features:
- Connects to Kraken WebSocket
- Writes directly to `bitcoin_ticks` table
- Batches up to 100 ticks or 5 seconds
- Auto-reconnects with exponential backoff
- Handles "cursor already closed" errors
- Runs via launchd as a service

Critical code sections:
```python
# Connection with proper cleanup
def connect_db(self):
    """Connect to PostgreSQL"""
    try:
        # Close existing connection and cursor
        if self.cursor:
            self.cursor.close()
            self.cursor = None
        if self.conn:
            self.conn.close()
            self.conn = None
            
        # Create new connection
        self.conn = psycopg2.connect(**self.db_config)
        self.conn.autocommit = False
        self.cursor = self.conn.cursor()
        logger.info("Connected to PostgreSQL")
        return True
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        self.cursor = None
        self.conn = None
        return False
        
# Batch flushing
if len(self.batch) >= self.batch_size or \
   (datetime.now() - self.last_flush).seconds >= self.flush_interval:
    self.flush_batch()
```

### Component 2: Cascade Refresh Procedure
**File**: `sql/bitcoin_cascade_refresh.sql`
```sql
CREATE OR REPLACE PROCEDURE cascade_bitcoin_aggregate_refresh()
LANGUAGE plpgsql
AS $$
BEGIN
    -- Refresh in order from lowest to highest timeframe
    RAISE NOTICE 'Starting cascade refresh at %', NOW();
    
    -- 1m candles (from raw ticks)
    RAISE NOTICE 'Refreshing 1m candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_1m', NULL, NULL);
    
    -- 5m candles (from raw ticks)
    RAISE NOTICE 'Refreshing 5m candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_5m', NULL, NULL);
    
    -- 15m candles (from 5m)
    RAISE NOTICE 'Refreshing 15m candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_15m', NULL, NULL);
    
    -- 1h candles (from 15m)
    RAISE NOTICE 'Refreshing 1h candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_1h', NULL, NULL);
    
    -- 4h candles (from 1h)
    RAISE NOTICE 'Refreshing 4h candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_4h', NULL, NULL);
    
    -- 12h candles (from 4h)
    RAISE NOTICE 'Refreshing 12h candles...';
    CALL refresh_continuous_aggregate('bitcoin_candles_12h', NULL, NULL);
    
    RAISE NOTICE 'Cascade refresh complete at %', NOW();
END;
$$;
```

### Component 3: External Scheduler Script
**File**: `sql/cascade_refresh_cron.sh`
```bash
#!/bin/bash
# Bitcoin cascade refresh script with clock alignment
# Runs every 5 seconds with clock alignment at :01, :06, :11, :16, :21, :26, :31, :36, :41, :46, :51, :56

# Database connection
DB_NAME="forex_trading"
DB_USER="postgres"
PSQL="/opt/homebrew/opt/postgresql@17/bin/psql"

# Log with timestamp including milliseconds for precise timing verification
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S.%3N')] $1"
}

# Calculate seconds to wait until next target time
calculate_wait_time() {
    local current_second=$(date +%S)
    # Remove leading zero to prevent octal interpretation
    current_second=$((10#$current_second))
    
    # Target times: 1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56
    local targets=(1 6 11 16 21 26 31 36 41 46 51 56)
    
    # Find next target
    local next_target=-1
    for target in "${targets[@]}"; do
        if [ $current_second -lt $target ]; then
            next_target=$target
            break
        fi
    done
    
    # If no target found in current minute, wrap to next minute
    if [ $next_target -eq -1 ]; then
        next_target=61  # This will give us :01 of next minute
    fi
    
    # Calculate wait time
    local wait_seconds=$((next_target - current_second))
    
    # If we're wrapping to next minute
    if [ $wait_seconds -gt 60 ]; then
        wait_seconds=$((61 - current_second))
    fi
    
    echo $wait_seconds
}

# Main execution
log "Script invoked"

# Calculate and wait for alignment
wait_time=$(calculate_wait_time)
current_time=$(date '+%H:%M:%S')

if [ $wait_time -gt 0 ]; then
    log "Current time: $current_time - Waiting $wait_time seconds for clock alignment"
    sleep $wait_time
fi

# Log execution start
log "Starting Bitcoin cascade refresh at aligned time"
start_time=$(date +%s.%N)

# Run the cascade procedure
# Use -q flag for quieter output and redirect stderr to filter NOTICEs
$PSQL -U "$DB_USER" -d "$DB_NAME" -q -c "CALL cascade_bitcoin_aggregate_refresh();" 2>&1 | while read line; do
    # Filter out NOTICE lines for cleaner logs, but keep errors
    if [[ ! "$line" =~ ^NOTICE: ]] && [[ ! -z "$line" ]]; then
        log "DB: $line"
    fi
done

# Check exit status
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    # Calculate execution time
    end_time=$(date +%s.%N)
    duration=$(echo "$end_time - $start_time" | bc)
    
    log "Cascade refresh completed successfully (duration: ${duration}s)"
    
    # Warn if execution took too long
    if (( $(echo "$duration > 5" | bc -l) )); then
        log "WARNING: Execution took longer than 5 seconds!"
    fi
else
    log "ERROR: Cascade refresh failed!"
    exit 1
fi
```

**Make executable**: `chmod +x sql/cascade_refresh_cron.sh`

### Component 4: LaunchD Services (Complete Files)

**Bitcoin Ingester**: `~/Library/LaunchAgents/com.sptraderb.bitcoin-ingester.plist`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sptraderb.bitcoin-ingester</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/Users/sebastian/anaconda3/bin/python3</string>
        <string>/Users/sebastian/Projects/SPtraderB/data-ingestion/live/kraken/direct-bitcoin-ingester.py</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>/Users/sebastian/Projects/SPtraderB/data-ingestion/live/kraken</string>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>
    
    <key>StandardOutPath</key>
    <string>/Users/sebastian/Projects/SPtraderB/data-ingestion/bitcoin-ingester.log</string>
    
    <key>StandardErrorPath</key>
    <string>/Users/sebastian/Projects/SPtraderB/data-ingestion/bitcoin-ingester.error.log</string>
    
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
```

**Cascade Refresh**: `~/Library/LaunchAgents/com.sptraderb.bitcoin-cascade-refresh.plist`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sptraderb.bitcoin-cascade-refresh</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>/Users/sebastian/Projects/SPtraderB/data-ingestion/sql/cascade_refresh_cron.sh</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>/Users/sebastian/Projects/SPtraderB/data-ingestion</string>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>StartInterval</key>
    <integer>5</integer>
    
    <key>StandardOutPath</key>
    <string>/Users/sebastian/Projects/SPtraderB/data-ingestion/cascade-refresh.log</string>
    
    <key>StandardErrorPath</key>
    <string>/Users/sebastian/Projects/SPtraderB/data-ingestion/cascade-refresh.error.log</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    
    <key>KeepAlive</key>
    <false/>
    
    <key>ThrottleInterval</key>
    <integer>5</integer>
</dict>
</plist>
```

## Hierarchical Aggregate Structure

### Understanding the Hierarchy
```sql
-- Check the hierarchy
SELECT 
    user_view_name,
    mat_hypertable_id,
    raw_hypertable_id
FROM _timescaledb_catalog.continuous_agg 
WHERE user_view_name LIKE 'bitcoin_candles%'
ORDER BY user_view_name;

-- Results show:
-- bitcoin_candles_1m:  raw_hypertable_id = 13 (bitcoin_ticks)
-- bitcoin_candles_5m:  raw_hypertable_id = 13 (bitcoin_ticks)  
-- bitcoin_candles_15m: raw_hypertable_id = 14 (bitcoin_candles_5m!) ← Hierarchical
-- bitcoin_candles_1h:  raw_hypertable_id = 15 (bitcoin_candles_15m!) ← Hierarchical
-- bitcoin_candles_4h:  raw_hypertable_id = 16 (bitcoin_candles_1h!) ← Hierarchical
-- bitcoin_candles_12h: raw_hypertable_id = 17 (bitcoin_candles_4h!) ← Hierarchical
```

### Time Bucket Alignment (Why 12h shows at 17:00)
TimescaleDB aligns buckets to UTC epoch (1970-01-01 00:00:00 UTC):
- 12-hour buckets align to: 17:00 and 05:00 (in PT/PDT)
- 4-hour buckets align to: 01:00, 05:00, 09:00, 13:00, 17:00, 21:00
- This is NOT a bug - it's how time_bucket works with timezones

Example:
```sql
SELECT time_bucket('12 hours', '2025-07-12 01:00:00-07'::timestamptz);
-- Returns: 2025-07-11 17:00:00-07 (previous 5 PM)
```

## Setup Commands

### 1. Create Database Objects
```bash
psql -U postgres -d forex_trading < sql/bitcoin_schema_setup.sql
psql -U postgres -d forex_trading < sql/create_bitcoin_1min_candles.sql
psql -U postgres -d forex_trading < sql/bitcoin_cascade_refresh.sql
```

### 2. Install Python Dependencies
```bash
cd data-ingestion
pip install -r requirements.txt
```

### 3. Start Services
```bash
# Load services
launchctl load ~/Library/LaunchAgents/com.sptraderb.bitcoin-ingester.plist
launchctl load ~/Library/LaunchAgents/com.sptraderb.bitcoin-cascade-refresh.plist

# Verify they're running
launchctl list | grep bitcoin
```

## Monitoring & Troubleshooting

### Check Service Status
```bash
# Are services running?
launchctl list | grep bitcoin

# Check process
ps aux | grep -E "direct-bitcoin-ingester|cascade_refresh" | grep -v grep
```

### Check Logs
```bash
# Ingester logs
tail -f bitcoin-ingester.log        # Normal output
tail -f bitcoin-ingester.error.log  # Errors only

# Cascade logs
tail -f cascade-refresh.log
tail -f cascade-refresh.error.log
```

### Check Data Freshness
```bash
psql -U postgres -d forex_trading -c "
SELECT 
    timeframe,
    TO_CHAR(MAX(time), 'HH24:MI:SS') as latest,
    TO_CHAR(NOW() - MAX(time), 'MI:SS') as lag
FROM (
    SELECT '1m' as timeframe, time FROM bitcoin_candles_1m
    UNION ALL SELECT '5m', time FROM bitcoin_candles_5m
    UNION ALL SELECT '15m', time FROM bitcoin_candles_15m
    UNION ALL SELECT '1h', time FROM bitcoin_candles_1h
    UNION ALL SELECT '4h', time FROM bitcoin_candles_4h
    UNION ALL SELECT '12h', time FROM bitcoin_candles_12h
) t
GROUP BY timeframe
ORDER BY timeframe;"
```

### Common Issues & Fixes

**1. "psql: command not found" in cascade logs**
- Update PSQL path in cascade_refresh_cron.sh
- Find your path: `which psql`

**2. "cursor already closed" errors**
- Already handled in ingester code with reconnection logic
- Check `connect_db()` method properly closes and nullifies cursor

**3. Aggregates not updating**
- Check cascade job is running: `launchctl list | grep cascade`
- Run manually: `psql -U postgres -d forex_trading -c "CALL cascade_bitcoin_aggregate_refresh();"`
- Check for errors in cascade-refresh.error.log

**4. Large lag on higher timeframes**
- Normal on startup - hierarchical aggregates need multiple cascades to catch up
- Each 5-second cascade (at clock-aligned times) moves data up one level
- Full propagation from 1m to 12h takes ~3 minutes

**5. Python ingester crashes**
- LaunchD will auto-restart (check ThrottleInterval)
- Check bitcoin-ingester.error.log for crash reason
- Common: WebSocket timeout (handled by reconnect logic)

### Stop Services
```bash
launchctl unload ~/Library/LaunchAgents/com.sptraderb.bitcoin-ingester.plist
launchctl unload ~/Library/LaunchAgents/com.sptraderb.bitcoin-cascade-refresh.plist
```

## To Replicate for Other Assets

### 1. Copy and Modify Ingester
```bash
cp live/kraken/direct-bitcoin-ingester.py live/oanda/direct-forex-ingester.py
# Modify: WebSocket URL, parsing logic, table name
```

### 2. Create Tables
```sql
-- Create tick table
CREATE TABLE forex_ticks (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    bid DECIMAL(12,5) NOT NULL,
    ask DECIMAL(12,5) NOT NULL,
    bid_size INTEGER DEFAULT 0,
    ask_size INTEGER DEFAULT 0,
    spread DECIMAL(10,5) GENERATED ALWAYS AS (ask - bid) STORED,
    mid_price DECIMAL(12,5) GENERATED ALWAYS AS ((bid + ask) / 2) STORED
);
SELECT create_hypertable('forex_ticks', 'time');

-- Create aggregates (hierarchical pattern)
CREATE MATERIALIZED VIEW forex_candles_5m
WITH (timescaledb.continuous) AS
SELECT time_bucket('5 minutes', time) AS time,
       symbol,
       FIRST(bid, time) AS open,
       MAX(bid) AS high,
       MIN(bid) AS low,
       LAST(bid, time) AS close
FROM forex_ticks
GROUP BY time_bucket('5 minutes', time), symbol
WITH NO DATA;

-- Continue pattern...
```

### 3. Create Cascade Procedure
```sql
CREATE OR REPLACE PROCEDURE cascade_forex_aggregate_refresh()
LANGUAGE plpgsql
AS $$
BEGIN
    -- Same pattern as Bitcoin
    CALL refresh_continuous_aggregate('forex_candles_5m', NULL, NULL);
    CALL refresh_continuous_aggregate('forex_candles_15m', NULL, NULL);
    -- etc...
END;
$$;
```

### 4. Create New LaunchD Services
- Copy the plist files
- Update paths and names
- Load with launchctl

## Critical Success Factors

1. **External Scheduling**: MUST use OS-level scheduling (launchd/cron/systemd)
2. **Proper Order**: Cascade MUST run from lowest to highest timeframe
3. **Direct Connection**: No middleware, no message queues
4. **Hierarchical Aggregates**: Build higher timeframes from lower ones
5. **No TimescaleDB Jobs**: Cannot use add_job() with procedures - this is the core limitation

## Why This Pattern Works

1. **Bypasses TimescaleDB limitations**: External scheduler can call procedures
2. **Guarantees order**: Single cascade procedure ensures proper refresh sequence  
3. **Simple and reliable**: No complex distributed systems
4. **Battle-tested**: Running 24/7 with perfect data consistency

This pattern is the result of discovering that TimescaleDB's job system fundamentally cannot handle hierarchical aggregate refreshes. The external scheduler is not a workaround - it's the ONLY solution.