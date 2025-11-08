#!/bin/bash

# Import CSV to TimescaleCloud
# Usage: ./import-csv-to-timescale.sh your_data.csv

CSV_FILE="$1"

if [ -z "$CSV_FILE" ]; then
    echo "Usage: $0 <csv_file>"
    echo "Example: $0 forex_data.csv"
    exit 1
fi

if [ ! -f "$CSV_FILE" ]; then
    echo "Error: File $CSV_FILE not found"
    exit 1
fi

DATABASE_URL="postgres://tsdbadmin:f176m7h5n2q6cv01@dsahkb3sce.sko4l85hee.tsdb.cloud.timescale.com:32588/tsdb?sslmode=require"

echo "📊 Importing CSV data to TimescaleCloud..."
echo "File: $CSV_FILE"
echo ""

# Clear existing test data
echo "1. Clearing test data..."
psql "$DATABASE_URL" -c "DELETE FROM forex_ticks WHERE source = 'test';" 2>/dev/null

# Import CSV using COPY command
echo "2. Importing CSV data..."
psql "$DATABASE_URL" -c "\COPY forex_ticks(time, symbol, bid, ask, bid_size, ask_size, source) FROM '$CSV_FILE' WITH CSV HEADER"

if [ $? -eq 0 ]; then
    echo "✅ Import successful!"

    # Show data statistics
    echo ""
    echo "3. Verifying imported data..."
    psql "$DATABASE_URL" -c "
        SELECT
            symbol,
            COUNT(*) as tick_count,
            MIN(time) as earliest,
            MAX(time) as latest
        FROM forex_ticks
        WHERE source != 'test'
        GROUP BY symbol;
    "

    echo ""
    echo "4. Testing candle generation..."
    psql "$DATABASE_URL" -c "
        SELECT * FROM forex_candles_1m
        WHERE symbol = 'EURUSD'
        ORDER BY time DESC
        LIMIT 5;
    "

    echo ""
    echo "✅ TimescaleCloud is ready!"
    echo ""
    echo "To use with your app:"
    echo "  export DATABASE_URL=\"$DATABASE_URL\""
    echo "  npm run tauri dev"
else
    echo "❌ Import failed. Please check your CSV format."
    echo ""
    echo "Expected CSV format:"
    echo "time,symbol,bid,ask,bid_size,ask_size,source"
    echo "2024-08-01 07:00:00.487+00,EURUSD,1.08234,1.08245,100,100,historical"
fi