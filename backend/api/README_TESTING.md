# Testing the Orchestrator API

## Quick Start

### 1. Start the API Server

```bash
cd /Users/sebastian/Projects/SPtraderB/api

# Make sure environment is set
cat .env

# Should show:
# WS_MARKET_DATA_URL=https://ws-market-data-server.fly.dev

# Start the server
cargo run
```

Expected output:
```
INFO Starting SPtraderB API server...
INFO Connecting to database: ...
INFO Server listening on 0.0.0.0:3001
```

### 2. Run the Test Script

In a **new terminal**:

```bash
cd /Users/sebastian/Projects/SPtraderB/api
./test-backtest.sh
```

This will:
1. Check if server is running
2. Start a backtest for BTCUSD (Jan 1-7, 2024)
3. Poll for status
4. Fetch results

### 3. Manual Testing

If you prefer to test manually:

**Check Health:**
```bash
curl http://localhost:3001/health
```

**Start Backtest:**
```bash
curl -X POST http://localhost:3001/api/backtest/run \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_name": "test-strategy",
    "symbol": "BTCUSD",
    "timeframe": "1h",
    "start_date": "2024-01-01T00:00:00Z",
    "end_date": "2024-01-07T23:59:59Z",
    "initial_capital": 10000.0
  }'
```

**Check Status:**
```bash
curl http://localhost:3001/api/backtest/{backtest_id}/status
```

**Get Results:**
```bash
curl http://localhost:3001/api/backtest/{backtest_id}/results
```

## Expected Results

A successful backtest should return something like:

```json
{
  "backtest_id": "uuid-here",
  "start_capital": 10000.0,
  "end_capital": 10000.0,
  "total_pnl": 0.0,
  "total_trades": 0,
  "winning_trades": 0,
  "losing_trades": 0,
  "max_drawdown": 0.0,
  "sharpe_ratio": 0.0,
  "signals_generated": 0
}
```

**Note**: Since we haven't implemented signal generation yet, `total_trades` will be 0. The engine successfully:
- ✅ Fetches historical data from ws-market-data-server
- ✅ Processes all candles
- ✅ Tracks portfolio value
- ✅ Calculates Sharpe ratio
- ✅ Checks risk limits

## Troubleshooting

### Server won't start

**Error**: "Failed to connect to database"  
**Fix**: Auth/app-repo routes require a real Postgres. Set `DATABASE_URL` to a reachable Postgres (production uses Fly Postgres `sptraderb-api-db` in `iad`) and run migrations `migrations/001_create_users.sql` and `migrations/002_app_repos.sql`. If you only care about backtest endpoints locally, you can run without a DB, but auth/Kumquant repo routes will fail.

**Error**: "Address already in use"
**Fix**: Change `PORT=3002` in `.env`

### Backtest fails

**Check logs**: Look at terminal where `cargo run` is running

**Common issues**:
1. **Strategy not found**: Make sure `test-strategy.yaml` is in the api directory
2. **No data from ws-market-data-server**: Check if ws-market-data-server has data for BTCUSD
3. **Date range too large**: Try a smaller range (1 week instead of 1 month)

### Data server issues

**Test if ws-market-data-server has data:**
```bash
curl "https://ws-market-data-server.fly.dev/api/candles?symbol=BTCUSD&timeframe=1h&from=1704067200&to=1704672000"
```

If this returns empty or errors, try:
- Different symbol (EURUSD, GBPUSD)
- Different date range
- Check with the data server directly

## What's Being Tested

This test validates:
- ✅ API server starts successfully
- ✅ Health endpoint responds
- ✅ Backtest endpoint accepts requests
- ✅ Backtest runs in background
- ✅ Status endpoint works
- ✅ Results endpoint returns data
- ✅ HTTP client fetches from ws-market-data-server
- ✅ Decimal calculations work correctly
- ✅ File storage works

## Next Steps

Once this works:
1. Try different symbols and date ranges
2. Add signal generation logic
3. Implement position management
4. Deploy to Fly.io

## Files Created for Testing

- `.env` - Environment configuration
- `test-strategy.yaml` - Simple test strategy
- `test-backtest.sh` - Automated test script
- `README_TESTING.md` - This file
