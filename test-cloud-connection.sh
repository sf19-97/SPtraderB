#!/bin/bash

echo "Testing TimescaleCloud connection..."
echo ""

# Export the DATABASE_URL for the app to use
export DATABASE_URL="postgres://tsdbadmin:f176m7h5n2q6cv01@dsahkb3sce.sko4l85hee.tsdb.cloud.timescale.com:32588/tsdb?sslmode=require"

# Test direct connection
echo "1. Testing direct database connection..."
psql "$DATABASE_URL" -c "SELECT version();" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "   ✅ Direct connection successful"
else
    echo "   ❌ Direct connection failed"
    exit 1
fi

# Check data availability
echo ""
echo "2. Checking data availability..."
TICK_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM forex_ticks WHERE symbol = 'EURUSD';" 2>/dev/null | xargs)
echo "   Found $TICK_COUNT EURUSD ticks"

# Test candle aggregation
echo ""
echo "3. Testing candle aggregation..."
CANDLE_COUNT=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*) FROM (
        SELECT time_bucket('1 minute', time) as bucket
        FROM forex_ticks
        WHERE symbol = 'EURUSD'
        GROUP BY bucket
    ) t;" 2>/dev/null | xargs)
echo "   Can generate $CANDLE_COUNT 1-minute candles"

echo ""
echo "4. Latest data point:"
psql "$DATABASE_URL" -c "
    SELECT MAX(time) as latest_tick_time
    FROM forex_ticks
    WHERE symbol = 'EURUSD';" 2>/dev/null

echo ""
echo "✅ TimescaleCloud is ready for use!"
echo ""
echo "To run the app with TimescaleCloud:"
echo "  export DATABASE_URL=\"$DATABASE_URL\""
echo "  npm run tauri dev"