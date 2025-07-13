# Dukascopy Data Availability Findings

## Test Results (July 4, 2025)

### Data Delay
- **Consistent delay: 1-2 hours** from real-time
- Most recent test showed data available up to **2025-07-04 05:00 UTC** when tested at 06:29 UTC
- This represents a **1.5 hour delay**

### Symbol Coverage
Tested 17 currency pairs across different categories - all showed identical availability:

**Major Pairs:**
- EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, NZDUSD, USDCAD

**Cross Pairs:**
- EURGBP, EURJPY, GBPJPY, AUDJPY, NZDJPY

**Exotic Pairs:**
- EURNOK, EURSEK, USDMXN, USDTRY, USDZAR

### Key Findings
1. **All symbols update simultaneously** - no difference between majors and exotics
2. **Hourly updates** - data is provided in complete hourly chunks
3. **No partial hours** - you either get the full hour or nothing
4. **Consistent endpoint structure**: 
   ```
   https://datafeed.dukascopy.com/datafeed/{SYMBOL}/{YEAR}/{MONTH-1}/{DAY}/{HOUR}h_ticks.bi5
   ```

### Implications for Real-time Ingestion
- A monitoring service should check around X:05 or X:10 for data from hour X-2
- No need to check more frequently than every few minutes
- Can batch multiple symbols together since they update simultaneously
- Should track last successful ingestion timestamp to avoid re-downloading