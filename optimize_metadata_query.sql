-- Create index to speed up MIN/MAX queries on forex_ticks
-- This will make get_symbol_metadata MUCH faster

-- Create a composite index on symbol and time
-- This allows PostgreSQL to quickly find the min/max time for each symbol
CREATE INDEX IF NOT EXISTS idx_forex_ticks_symbol_time 
ON forex_ticks(symbol, time);

-- Analyze the table to update statistics
ANALYZE forex_ticks;

-- Test the query performance
EXPLAIN (ANALYZE, BUFFERS) 
SELECT 
    MIN(time) as start_time,
    MAX(time) as end_time,
    COUNT(*) as tick_count
FROM forex_ticks
WHERE symbol = 'EURUSD';