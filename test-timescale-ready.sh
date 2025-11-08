#!/bin/bash

echo "🔍 Testing TimescaleCloud Setup..."
echo ""

DATABASE_URL="postgres://tsdbadmin:f176m7h5n2q6cv01@dsahkb3sce.sko4l85hee.tsdb.cloud.timescale.com:32588/tsdb?sslmode=require"

# Test 1: Connection
echo "1. Testing connection..."
psql "$DATABASE_URL" -c "SELECT version();" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "   ✅ Connection successful"
else
    echo "   ❌ Connection failed"
    exit 1
fi

# Test 2: Hypertable status
echo ""
echo "2. Checking hypertable status..."
HYPERTABLE=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'forex_ticks';
" 2>/dev/null | xargs)

if [ "$HYPERTABLE" = "1" ]; then
    echo "   ✅ forex_ticks is a hypertable"
else
    echo "   ❌ forex_ticks is not a hypertable"
fi

# Test 3: Insert capability
echo ""
echo "3. Testing insert capability..."
psql "$DATABASE_URL" -c "
    INSERT INTO forex_ticks (time, symbol, bid, ask, bid_size, ask_size, source)
    VALUES (NOW() - INTERVAL '1 minute', 'TEST', 1.0850, 1.0851, 100, 100, 'test')
    ON CONFLICT DO NOTHING;
" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "   ✅ Can insert data"
else
    echo "   ❌ Cannot insert data"
fi

# Test 4: Views exist
echo ""
echo "4. Checking candle views..."
for timeframe in 1m 5m 15m 1h 4h 12h; do
    VIEW_EXISTS=$(psql "$DATABASE_URL" -t -c "
        SELECT COUNT(*) FROM information_schema.views
        WHERE table_name = 'forex_candles_${timeframe}';
    " 2>/dev/null | xargs)

    if [ "$VIEW_EXISTS" = "1" ]; then
        echo "   ✅ forex_candles_${timeframe} exists"
    else
        echo "   ❌ forex_candles_${timeframe} missing"
    fi
done

# Test 5: Current data status
echo ""
echo "5. Current data status..."
DATA_COUNT=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM forex_ticks WHERE source != 'test';
" 2>/dev/null | xargs)

echo "   📊 Data rows: $DATA_COUNT"

if [ "$DATA_COUNT" = "0" ]; then
    echo ""
    echo "⚠️  No data found. You need to import your CSV file."
    echo ""
    echo "To import data:"
    echo "  1. If you have the original CSV file:"
    echo "     ./import-csv-to-timescale.sh your_data.csv"
    echo ""
    echo "  2. Or re-upload via TimescaleCloud UI:"
    echo "     - Upload to the 'forex_ticks' table"
    echo "     - Map columns correctly"
else
    echo ""
    echo "✅ TimescaleCloud is configured and has data!"
fi

echo ""
echo "To run your app with TimescaleCloud:"
echo "  export DATABASE_URL=\"$DATABASE_URL\""
echo "  npm run tauri dev"

# Clean up test data
psql "$DATABASE_URL" -c "DELETE FROM forex_ticks WHERE source = 'test';" > /dev/null 2>&1