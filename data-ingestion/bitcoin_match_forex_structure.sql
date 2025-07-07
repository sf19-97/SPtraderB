-- Make Bitcoin tables match Forex tables structure exactly
-- This script aligns indexes and constraints to match forex_ticks

-- 1. Drop the PRIMARY KEY constraint and replace with UNIQUE constraint like forex
ALTER TABLE bitcoin_ticks DROP CONSTRAINT bitcoin_ticks_pkey;

-- 2. Create UNIQUE constraint matching forex_ticks_unique
ALTER TABLE bitcoin_ticks ADD CONSTRAINT bitcoin_ticks_unique UNIQUE (symbol, time);

-- 3. Add missing indexes to match forex_ticks exactly
-- Check existing indexes first
-- bitcoin_ticks already has: bitcoin_ticks_time_idx, idx_bitcoin_ticks_symbol_time

-- Add bitcoin_ticks_symbol_time_idx (symbol, time DESC)
CREATE INDEX IF NOT EXISTS bitcoin_ticks_symbol_time_idx 
ON bitcoin_ticks (symbol, time DESC);

-- Add bitcoin_ticks_time_symbol_idx (time DESC, symbol)
CREATE INDEX IF NOT EXISTS bitcoin_ticks_time_symbol_idx 
ON bitcoin_ticks (time DESC, symbol);

-- Note: We're keeping the precision differences (NUMERIC(12,5) vs NUMERIC(10,5))
-- because Bitcoin needs the extra precision for prices over $100,000

-- Verify the changes
\echo 'Bitcoin ticks indexes after changes:'
\d bitcoin_ticks