#!/bin/bash
# Bitcoin cascade refresh script with clock alignment
# Ensures execution at :01, :06, :11, :16, :21, :26, :31, :36, :41, :46, :51, :56

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