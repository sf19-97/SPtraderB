#!/bin/bash

# Load 7 days of EURUSD data for testing
echo "Loading EURUSD test data (last 7 days)..."

cd /Users/sebastian/Projects/SPtraderB/data-ingestion/backfill/dukascopy

# Calculate dates
END_DATE=$(date +%Y-%m-%d)
START_DATE=$(date -v-7d +%Y-%m-%d)

echo "Period: $START_DATE to $END_DATE"

# Load EURUSD
python dukascopy_ingester.py \
  --symbol EURUSD \
  --start-date "$START_DATE" \
  --end-date "$END_DATE" \
  --db-url "postgresql://postgres@localhost:5432/forex_trading"

echo "Done loading EURUSD data!"