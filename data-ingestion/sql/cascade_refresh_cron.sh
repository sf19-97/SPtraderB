#!/bin/bash
# Bitcoin cascade refresh script
# Runs every 30 seconds to refresh all aggregates in order

# Database connection
DB_NAME="forex_trading"
DB_USER="postgres"
PSQL="/opt/homebrew/opt/postgresql@17/bin/psql"

# Log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "Starting Bitcoin cascade refresh"

# Run the cascade procedure
$PSQL -U "$DB_USER" -d "$DB_NAME" -c "CALL cascade_bitcoin_aggregate_refresh();" 2>&1 | while read line; do
    # Filter out NOTICE lines for cleaner logs, but keep errors
    if [[ ! "$line" =~ ^NOTICE: ]]; then
        log "$line"
    fi
done

log "Cascade refresh complete"