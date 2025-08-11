# Performance Maintenance Checklist

## Daily Operations
No special maintenance required - the system is designed to be self-maintaining.

## After Adding New Data (Bulk Ingestion)

### ✅ Post-Ingestion Checklist
- [ ] Run `ANALYZE forex_ticks;` to update PostgreSQL statistics
- [ ] Clear backend metadata cache for affected symbols
- [ ] Verify first query performance is acceptable (<200ms)
- [ ] Check that continuous aggregates refreshed properly

### 📝 Commands
```sql
-- Update statistics after bulk insert
ANALYZE forex_ticks;

-- Verify data was added
SELECT symbol, COUNT(*), MIN(time), MAX(time) 
FROM forex_ticks 
WHERE time > NOW() - INTERVAL '1 day'
GROUP BY symbol;
```

## When Adding New Currency Pairs

### ✅ New Symbol Checklist
- [ ] Add symbol to pre-warming list in `main.rs`
- [ ] Test metadata query performance for new symbol
- [ ] Verify index is being used (EXPLAIN ANALYZE)
- [ ] Update documentation with new symbol

### 📝 Code Changes
```rust
// In src-tauri/src/main.rs
let symbols = vec!["EURUSD", "USDJPY", "GBPUSD", "NEW_SYMBOL"];
```

## Monthly Performance Audit

### ✅ Monthly Checklist
- [ ] Check index health and size
- [ ] Review cache hit rates from logs
- [ ] Analyze slow query logs
- [ ] Verify pre-warming is working
- [ ] Check database table statistics

### 📝 Monitoring Queries
```sql
-- Index health check
SELECT 
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as size,
    idx_scan as scans_count,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes 
WHERE schemaname = 'public' 
  AND tablename = 'forex_ticks'
ORDER BY idx_scan DESC;

-- Table statistics
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    n_live_tup as row_count,
    n_dead_tup as dead_rows,
    last_vacuum,
    last_analyze
FROM pg_stat_user_tables 
WHERE tablename = 'forex_ticks';

-- Check for slow queries
SELECT 
    query,
    calls,
    mean_exec_time,
    total_exec_time
FROM pg_stat_statements 
WHERE query LIKE '%forex_ticks%' 
  AND mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Performance Benchmarks

### Expected Query Times
| Query Type | Cold (ms) | Warm (ms) | Cache Hit (ms) |
|------------|-----------|-----------|----------------|
| Metadata MIN/MAX | 50-100 | 20-50 | <1 |
| Candle 3 months | 100-200 | 50-100 | <1 |
| Symbol list | 10-20 | 5-10 | <1 |

### Warning Signs
- ⚠️ Metadata query >500ms
- ⚠️ Cache hit rate <80%
- ⚠️ Index scans = 0 (index not being used)
- ⚠️ Dead tuples >10% of live tuples

## Emergency Procedures

### If Performance Suddenly Degrades

1. **Check index exists**:
```sql
\d forex_ticks
```

2. **Rebuild index if needed**:
```sql
REINDEX INDEX CONCURRENTLY idx_forex_ticks_symbol_time;
```

3. **Clear all caches**:
- Restart the application
- Or manually clear backend caches

4. **Update table statistics**:
```sql
VACUUM ANALYZE forex_ticks;
```

### If Index Gets Corrupted

```sql
-- Create new index with different name
CREATE INDEX CONCURRENTLY idx_forex_ticks_symbol_time_new 
ON forex_ticks(symbol, time);

-- Drop old index
DROP INDEX idx_forex_ticks_symbol_time;

-- Rename new index
ALTER INDEX idx_forex_ticks_symbol_time_new 
RENAME TO idx_forex_ticks_symbol_time;
```

## Capacity Planning

### Current Performance Limits
- Tested with 77.9M rows
- Index size: ~2-3GB (estimate)
- Query time scales logarithmically

### Scaling Projections
| Row Count | Index Size | Query Time |
|-----------|------------|------------|
| 100M | ~3GB | ~100ms |
| 500M | ~15GB | ~150ms |
| 1B | ~30GB | ~200ms |

### When to Consider Partitioning
- [ ] When forex_ticks exceeds 500M rows
- [ ] When index size exceeds available RAM
- [ ] When maintenance operations take >1 hour

## Automation Scripts

### Create Monitoring Script
```bash
#!/bin/bash
# save as check_performance.sh

psql -U postgres -d forex_trading <<EOF
-- Performance check report
\echo 'PERFORMANCE CHECK REPORT'
\echo '======================='
\echo ''
\echo 'Index Health:'
SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid)) as size, idx_scan 
FROM pg_stat_user_indexes 
WHERE indexname = 'idx_forex_ticks_symbol_time';

\echo ''
\echo 'Recent Metadata Query Performance:'
EXPLAIN (ANALYZE, TIMING OFF) 
SELECT time FROM forex_ticks WHERE symbol = 'EURUSD' ORDER BY time DESC LIMIT 1;

\echo ''
\echo 'Table Statistics:'
SELECT pg_size_pretty(pg_total_relation_size('forex_ticks')) as total_size,
       to_char(n_live_tup, '999,999,999') as live_rows,
       last_analyze
FROM pg_stat_user_tables WHERE tablename = 'forex_ticks';
EOF
```

### Schedule Regular Maintenance
```bash
# Add to crontab for weekly stats update
0 3 * * 0 psql -U postgres -d forex_trading -c "ANALYZE forex_ticks;"
```

## Documentation Updates

When making performance-related changes:
1. Update this checklist
2. Update `/docs/METADATA_PERFORMANCE_OPTIMIZATION.md`
3. Add notes to `/CLAUDE.md` for significant changes
4. Document any new pre-warmed symbols