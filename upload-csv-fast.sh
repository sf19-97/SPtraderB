#!/bin/bash

echo "📊 Uploading CSV data to TimescaleCloud using COPY..."

DATABASE_URL="postgres://tsdbadmin:f176m7h5n2q6cv01@dsahkb3sce.sko4l85hee.tsdb.cloud.timescale.com:32588/tsdb?sslmode=require"
CSV_FILE="data-ingestion/backfill/dukascopy/data/EURUSD_20241023_20250123_ticks.csv"

# Create a temporary file with reordered columns
echo "Preparing data..."
TEMP_FILE="/tmp/forex_ticks_upload.csv"

# Reorder columns: CSV has (time,symbol,ask,bid,ask_size,bid_size)
# We need: (time,symbol,bid,ask,bid_size,ask_size,source)
echo "time,symbol,bid,ask,bid_size,ask_size,source" > $TEMP_FILE

# Process the CSV, skipping header and reordering columns
tail -n +2 "$CSV_FILE" | awk -F',' '{
    # Remove any decimals from size fields and add source
    bid_size = int($6)
    ask_size = int($5)
    print $1","$2","$4","$3","bid_size","ask_size",dukascopy"
}' >> $TEMP_FILE

echo "Uploading to TimescaleCloud..."

# Use psql COPY command for fast upload
psql "$DATABASE_URL" -c "\COPY forex_ticks(time,symbol,bid,ask,bid_size,ask_size,source) FROM '$TEMP_FILE' WITH CSV HEADER"

if [ $? -eq 0 ]; then
    echo "✅ Upload successful!"

    # Verify the data
    echo ""
    echo "Verifying data..."
    psql "$DATABASE_URL" -c "
        SELECT
            symbol,
            COUNT(*) as tick_count,
            MIN(time) as earliest,
            MAX(time) as latest
        FROM forex_ticks
        WHERE source = 'dukascopy'
        GROUP BY symbol;
    "

    echo ""
    echo "Testing candle views..."
    psql "$DATABASE_URL" -c "
        SELECT * FROM forex_candles_1m
        WHERE symbol = 'EURUSD'
        ORDER BY time DESC
        LIMIT 5;
    "

    # Clean up temp file
    rm $TEMP_FILE

    echo ""
    echo "✅ TimescaleCloud is ready with data!"
    echo ""
    echo "To use with your app:"
    echo "  export DATABASE_URL=\"$DATABASE_URL\""
    echo "  npm run tauri dev"
else
    echo "❌ Upload failed"
    rm $TEMP_FILE
fi