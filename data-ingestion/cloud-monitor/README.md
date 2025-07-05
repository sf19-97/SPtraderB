# Dukascopy Data Monitor - AWS Lambda Function

## Overview
This AWS Lambda function monitors Dukascopy data availability 24/7, providing a REST API endpoint that returns the latest available data timestamp for forex symbols. It enables automated data ingestion by allowing local services to check what data is available without directly querying Dukascopy.

## Features
- **Optimized Performance**: ~6 seconds execution time (vs 12s for naive approach)
- **Built-in Caching**: 5-minute cache to reduce Dukascopy API calls
- **Smart Checking**: Leverages the fact that all symbols update simultaneously
- **No External Dependencies**: Uses Python's built-in `urllib` instead of `requests`
- **RESTful API**: Simple HTTP endpoint accessible from anywhere

## How It Works

### Optimization Strategy
The function uses a "baseline check" approach:
1. Check EURUSD first (since all symbols typically update together)
2. Use that timestamp as baseline for other symbols
3. Only do full search if a symbol differs from baseline
4. Result: 75% faster than checking each symbol independently

### Data Freshness
- Dukascopy provides tick data with a 1-2 hour delay
- Data is released in complete hourly chunks
- All symbols update simultaneously
- Function checks backwards from current hour to find latest data

## API Endpoints

### GET /
Returns latest available data for all configured symbols.

**Response:**
```json
{
  "symbols": {
    "EURUSD": {
      "latest_available": "2025-07-04T21:00:00+00:00",
      "status": "ok"
    },
    "GBPUSD": {
      "latest_available": "2025-07-04T21:00:00+00:00",
      "status": "ok"
    }
    // ... other symbols
  },
  "checked_at": "2025-07-04T22:30:00+00:00",
  "summary": {
    "total_symbols": 12,
    "latest_common_hour": "2025-07-04T21:00:00+00:00",
    "data_delay_hours": 1.5
  }
}
```

### GET /health
Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-07-04T22:30:00+00:00"
}
```

## Configuration

### Symbols
The function monitors these forex pairs by default:
- Major pairs: EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, NZDUSD, USDCAD
- Cross pairs: EURGBP, EURJPY, GBPJPY, AUDJPY, NZDJPY

To modify symbols, edit the `SYMBOLS` list at the top of the function.

### Cache Settings
- **TTL**: 300 seconds (5 minutes)
- **Scope**: All symbols cached together
- Prevents excessive Dukascopy API calls
- Returns cached data with age information in logs

## Deployment

### AWS Lambda Settings
- **Runtime**: Python 3.11 or 3.12
- **Handler**: lambda_function.lambda_handler
- **Memory**: 128 MB (sufficient)
- **Timeout**: 30 seconds (recommended)
- **Environment**: No environment variables needed

### API Gateway Configuration
1. Create REST API
2. Create resource with ANY method
3. Set integration type to Lambda Function
4. Deploy to stage (e.g., "prod")
5. Note the invoke URL

### Permissions
The Lambda function needs:
- Basic Lambda execution role
- No additional AWS permissions required
- Makes external HTTPS requests to datafeed.dukascopy.com

## Cost Analysis
- **Lambda**: Free tier covers 1M requests/month
- **API Gateway**: Free tier covers 1M requests/month
- **Expected usage**: ~8,640 requests/month (every 5 minutes)
- **Total cost**: $0 (well within free tier)

## Integration Example

### Python Client
```python
import requests

# Check data availability
response = requests.get("https://your-api.execute-api.region.amazonaws.com/prod/")
data = response.json()

# Get latest timestamp for EURUSD
eurusd_latest = data['symbols']['EURUSD']['latest_available']
print(f"Latest EURUSD data: {eurusd_latest}")

# Check delay
delay_hours = data['summary']['data_delay_hours']
print(f"Data is {delay_hours:.1f} hours behind")
```

### Bash/Curl
```bash
# Check all symbols
curl https://your-api.execute-api.region.amazonaws.com/prod/

# Health check
curl https://your-api.execute-api.region.amazonaws.com/prod/health
```

## Monitoring & Debugging

### CloudWatch Logs
- Function automatically logs to CloudWatch
- Look for log group: `/aws/lambda/dukascopy-monitor`
- Key log messages:
  - "Fast checking - finding baseline with EURUSD..."
  - "Found data for SYMBOL at TIMESTAMP"
  - "Returning cached data (age: X.Xs)"

### Common Issues

1. **Timeout Errors**
   - Increase Lambda timeout to 30+ seconds
   - Check if Dukascopy is accessible

2. **No Data Found**
   - Usually means checking too far in future
   - Data typically 1-2 hours behind current time

3. **Different Symbol Timestamps**
   - Rare but possible during Dukascopy updates
   - Function handles this with individual symbol checks

## Technical Details

### Dukascopy URL Format
```
https://datafeed.dukascopy.com/datafeed/{SYMBOL}/{YEAR}/{MONTH-1}/{DAY}/{HOUR}h_ticks.bi5
```
**Important**: Month is 0-indexed (January = 0, December = 11)

### HTTP Method
- Uses HEAD requests to check file existence
- Doesn't download actual tick data
- Returns 200 if data exists, 404 if not yet available

### Performance Optimizations
1. Baseline checking reduces requests by ~75%
2. Smart hour ordering: checks likely delays first [1, 2, 0, 3...]
3. In-memory caching eliminates redundant checks
4. urllib instead of requests (no import overhead)

## Future Enhancements
- Add configurable symbol lists via environment variables
- Implement symbol-specific cache keys
- Add metrics for monitoring data delay trends
- Support for checking specific date ranges
- WebSocket support for push notifications