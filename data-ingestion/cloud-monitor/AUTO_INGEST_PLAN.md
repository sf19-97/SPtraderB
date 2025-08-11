# Automated Dukascopy Data Ingestion Plan

## Overview
This document outlines the plan to automate Dukascopy tick data ingestion, eliminating manual runs and ensuring your database stays current within the 1-2 hour delay window.

## Current State
- **Manual Process**: Running `python dukascopy_ingester.py` with date ranges
- **Data Delay**: Dukascopy provides data with a consistent 1-2 hour delay
- **Database**: PostgreSQL with TimescaleDB storing tick data and continuous aggregates
- **Finding**: All forex pairs update simultaneously (no difference between majors/exotics)

## Problem Statement
1. Manual ingestion is error-prone and creates data gaps
2. No visibility into when new data becomes available
3. Risk of missing data during system downtime
4. No automated way to catch up after outages

## Proposed Architecture: Hybrid Pull Model

### Cloud Component (Monitoring Service)
A lightweight service that runs 24/7 checking Dukascopy data availability.

**Technology Options:**
- AWS Lambda + API Gateway (recommended)
- Google Cloud Functions
- Cheap VPS with cron job
- Vercel/Netlify Functions

**Responsibilities:**
1. Check Dukascopy endpoints every 5-10 minutes
2. Track latest available hour for each symbol
3. Expose REST API for local app to query
4. Cache results to minimize Dukascopy requests

### Local Component (Ingestion Service)
A service running on your machine that pulls from cloud monitor and ingests new data.

**Responsibilities:**
1. Poll cloud monitor API every 15-30 minutes
2. Compare cloud's "latest available" with local database
3. Trigger ingestion for gaps
4. Handle errors and retries
5. Log all activities

## Implementation Plan

### Phase 1: Cloud Monitor (What Web Claude Will Build)

**1. Lambda Function Structure:**
```
/dukascopy-monitor
  ├── lambda_function.py      # Main handler
  ├── requirements.txt        # Dependencies (requests, etc.)
  ├── config.py              # Symbols list, endpoints
  └── deploy.sh              # Deployment script
```

**2. Core Logic:**
```python
# Pseudocode for Lambda
def lambda_handler(event, context):
    # Check if we have cached results (5 min TTL)
    cached = get_from_cache()
    if cached and not expired:
        return cached
    
    # Check each symbol
    results = {}
    for symbol in SYMBOLS:
        latest = check_latest_hour(symbol)
        results[symbol] = {
            "latest_available": latest,
            "checked_at": now()
        }
    
    # Cache and return
    save_to_cache(results)
    return {
        "statusCode": 200,
        "body": json.dumps(results)
    }
```

**3. API Endpoints:**
- `GET /latest` - Returns all symbols' latest data
- `GET /latest/{symbol}` - Single symbol check
- `GET /health` - Service health check

**4. Deployment Requirements:**
- AWS Account (or Google Cloud)
- API Gateway configuration
- CloudWatch logs for debugging
- Environment variables for configuration

### Phase 2: Local Ingestion Service (Your Local Build)

**1. Service Structure:**
```
/auto-ingester
  ├── monitor.py           # Polls cloud API
  ├── ingester.py         # Triggers dukascopy_ingester
  ├── scheduler.py        # Manages timing
  ├── config.yaml         # Local configuration
  └── auto_ingester.log   # Activity logs
```

**2. Configuration File:**
```yaml
# config.yaml
cloud_monitor:
  url: "https://your-api.execute-api.region.amazonaws.com/prod"
  poll_interval: 900  # 15 minutes in seconds

database:
  url: "postgresql://postgres@localhost:5432/forex_trading"

symbols:
  - EURUSD
  - GBPUSD
  - USDJPY
  # ... etc

ingestion:
  batch_size: 7  # Days to ingest at once
  retry_attempts: 3
  retry_delay: 60
```

**3. Integration Points:**
- Uses existing `dukascopy_ingester.py` (no changes needed)
- Writes to existing PostgreSQL database
- Respects TimescaleDB continuous aggregates
- Compatible with current codebase

## Benefits

1. **Automated**: No manual intervention required
2. **Resilient**: Catches up automatically after downtime
3. **Efficient**: Only downloads what's needed
4. **Monitored**: Cloud logs show system health
5. **Scalable**: Easy to add more symbols
6. **Cost-Effective**: Lambda free tier covers this use case

## Security Considerations

1. **Cloud Side**:
   - No sensitive data stored
   - Read-only operations
   - Rate limiting on API
   - HTTPS only

2. **Local Side**:
   - Database credentials stay local
   - No exposed ports
   - Pull model (not push)

## Cost Analysis

**AWS Lambda Costs:**
- Free tier: 1M requests/month
- Your usage: ~8,640 requests/month (every 5 min)
- Cost: $0 (well within free tier)

**Data Transfer:**
- Response size: ~1KB per request
- Monthly transfer: ~8.6MB
- Cost: $0 (within free tier)

## Migration Path

1. Deploy cloud monitor
2. Test with curl/browser
3. Build local service
4. Run in parallel with manual process
5. Verify data consistency
6. Disable manual process

## Fallback Strategy

If cloud service fails:
- Local service logs errors
- Can still run manual ingestion
- No data corruption risk
- Easy to revert

## What Web Claude Needs to Know

When implementing the cloud component:

1. **Dukascopy URL Pattern**:
   ```
   https://datafeed.dukascopy.com/datafeed/{SYMBOL}/{YEAR}/{MONTH-1}/{DAY}/{HOUR}h_ticks.bi5
   ```
   Note: Month is 0-indexed (January = 0)

2. **Symbols Format**:
   - Your format: EURUSD
   - Dukascopy format: EURUSD (same)
   - No conversion needed

3. **Availability Pattern**:
   - Data available in complete hours only
   - 1-2 hour delay is consistent
   - All symbols update together

4. **Checking Strategy**:
   - Use HEAD requests (don't download)
   - Start from current hour, work backwards
   - Stop at first available hour
   - Cache results for 5 minutes

5. **Error Handling**:
   - 404 = No data yet (normal)
   - 200 = Data available
   - Timeout after 10 seconds
   - Retry failed requests once

## Next Steps

1. **For Web Claude**:
   - Create Lambda function
   - Set up API Gateway
   - Deploy and test
   - Provide endpoint URL

2. **For Desktop Claude**:
   - Build local monitor service
   - Test with mock cloud endpoint
   - Integrate with real endpoint
   - Add to system startup

## Success Criteria

- Data never more than 2 hours behind
- Zero manual intervention
- Automatic recovery from outages
- Clear logs of all activities
- No impact on existing system