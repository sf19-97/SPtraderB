# Metadata Performance Optimization

## Overview
This document details the critical performance optimization that reduced metadata query time from **12+ seconds to under 100ms** through database indexing and query optimization.

## The Problem
The `get_symbol_metadata` function was executing a query that scanned 77.9 million rows:
```sql
SELECT MIN(time), MAX(time), COUNT(*) 
FROM forex_ticks 
WHERE symbol = $1
```

Without proper indexing, PostgreSQL had to scan every row in the table, resulting in:
- Cold start: 12-30 seconds for metadata fetch
- Total app load time: 10-48 seconds

## The Solution

### 1. Database Index (CRITICAL)
Created a composite index on the forex_ticks table:
```sql
CREATE INDEX IF NOT EXISTS idx_forex_ticks_symbol_time 
ON forex_ticks(symbol, time);
```

This index enables:
- O(log n) lookups for MIN/MAX queries
- Efficient range scans for specific symbols
- Automatic propagation to all TimescaleDB chunks

### 2. Query Optimization
Split the single aggregate query into three optimized queries that leverage the index:

```rust
// Old query (slow - full table scan)
SELECT MIN(time), MAX(time), COUNT(*) FROM forex_ticks WHERE symbol = $1

// New queries (fast - index seeks)
SELECT time FROM forex_ticks WHERE symbol = $1 ORDER BY time ASC LIMIT 1   -- MIN
SELECT time FROM forex_ticks WHERE symbol = $1 ORDER BY time DESC LIMIT 1  -- MAX
SELECT COUNT(*) FROM forex_ticks WHERE symbol = $1                         -- COUNT
```

Performance improvement:
- MIN query: 12.8ms
- MAX query: 0.7ms
- COUNT query: ~50ms
- Total: <100ms (vs 12,000ms before)

### 3. Pre-warming
Added metadata pre-warming on startup to ensure queries are cached:
```rust
// Pre-warm metadata for common symbols
for symbol in ["EURUSD", "USDJPY"] {
    // Execute the three queries to warm PostgreSQL buffer cache
}
```

## Results

### Before Optimization
- Metadata fetch: 9,650-32,000ms
- Total cold start: 10-48 seconds
- Backend cache miss penalty: Severe

### After Optimization
- Metadata fetch: 50-100ms (99.5% improvement)
- Total cold start: <2 seconds
- Backend cache miss penalty: Minimal

## Maintenance Requirements

### When Adding New Data
When ingesting new tick data for existing symbols:
1. **No index maintenance required** - PostgreSQL maintains indexes automatically
2. **Clear metadata cache** after bulk inserts:
   ```rust
   // In Rust: Clear the metadata cache for the symbol
   state.metadata_cache.write().await.remove(&symbol);
   ```
3. **Frontend cache** will expire automatically (10-minute TTL)

### When Adding New Currency Pairs
When adding a new symbol (e.g., GBPUSD):

1. **Index is automatic** - The existing index covers all symbols
2. **Add to pre-warming list** in `main.rs`:
   ```rust
   let symbols = vec!["EURUSD", "USDJPY", "GBPUSD"]; // Add new pair
   ```
3. **First query will be slower** (~100ms) until cached
4. **No database changes needed** - Index works for all symbols

### Index Health Monitoring
Periodically check index health:
```sql
-- Check index size and usage
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
    idx_scan as index_scans
FROM pg_stat_user_indexes 
WHERE indexname = 'idx_forex_ticks_symbol_time';

-- Verify index is being used
EXPLAIN (ANALYZE, BUFFERS) 
SELECT time FROM forex_ticks 
WHERE symbol = 'EURUSD' 
ORDER BY time ASC LIMIT 1;
```

### Cache Configuration
Current cache TTLs that maintain performance:
- **Backend metadata cache**: 5 minutes
- **Backend candle cache**: 10 minutes  
- **Frontend metadata cache**: 10 minutes
- **Frontend candle cache**: 10 minutes

## Troubleshooting

### If Performance Degrades

1. **Check if index exists**:
   ```sql
   \d forex_ticks
   ```
   Should show: `idx_forex_ticks_symbol_time`

2. **Check query plans**:
   ```sql
   EXPLAIN ANALYZE SELECT time FROM forex_ticks 
   WHERE symbol = 'EURUSD' ORDER BY time ASC LIMIT 1;
   ```
   Should show "Index Scan" not "Seq Scan"

3. **Rebuild index if corrupted**:
   ```sql
   REINDEX INDEX idx_forex_ticks_symbol_time;
   ```

4. **Check cache hit rates** in console logs

### Common Issues

1. **Slow after adding millions of rows**:
   - Run `ANALYZE forex_ticks;` to update statistics
   - PostgreSQL query planner needs updated stats

2. **Index not used**:
   - Check if symbol has data: might be querying non-existent symbol
   - Ensure index isn't corrupted

3. **Cache misses**:
   - Check if metadata cache TTL is too short
   - Verify pre-warming is running on startup

## Best Practices

1. **Always pre-warm common symbols** on startup
2. **Monitor query performance** after large data ingestions
3. **Keep cache TTLs aligned** between frontend and backend
4. **Use EXPLAIN ANALYZE** before deploying query changes
5. **Document any new symbols** added to pre-warming

## Technical Details

### Why This Index Works
- **B-tree index** on (symbol, time) creates sorted structure
- **Symbol first** groups all ticks for a symbol together
- **Time second** allows fast MIN/MAX within each symbol group
- **TimescaleDB** automatically creates chunk-level indexes

### Query Execution Flow
1. PostgreSQL uses index to jump to first/last entry for symbol
2. Returns single row (LIMIT 1) without scanning others
3. COUNT still scans index entries but much faster than table scan

### Cache Layer Interaction
1. Frontend checks Zustand cache (instant)
2. Backend checks metadata cache (<1ms)
3. Database query with index (~50ms)
4. Results cached at both layers

## Related Documentation
- `/docs/DATABASE_SCHEMA.md` - Database structure
- `/docs/PERFORMANCE_OPTIMIZATION_SUMMARY.md` - All optimizations
- `/docs/add_metadata_index.sql` - Index creation script