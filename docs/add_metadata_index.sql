-- Add index to forex_ticks table to speed up metadata queries
-- This index will make MIN(time), MAX(time) queries nearly instant
-- Run this in your PostgreSQL database:

-- Create index on symbol and time columns
CREATE INDEX IF NOT EXISTS idx_forex_ticks_symbol_time 
ON forex_ticks(symbol, time);

-- This index will help with:
-- 1. get_symbol_metadata queries that do MIN/MAX on time
-- 2. Any queries filtering by symbol and time range
-- 3. The metadata pre-warming queries

-- To verify the index was created:
-- \d forex_ticks

-- To see if the index is being used:
-- EXPLAIN ANALYZE
-- SELECT MIN(time), MAX(time), COUNT(*) 
-- FROM forex_ticks 
-- WHERE symbol = 'EURUSD';