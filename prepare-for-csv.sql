-- Prepare TimescaleCloud for CSV data upload

-- Check if forex_ticks is a hypertable
SELECT * FROM timescaledb_information.hypertables WHERE hypertable_name = 'forex_ticks';

-- The table structure is already correct, just verify:
\d forex_ticks

-- Views are already created, verify they exist:
\dv forex_candles*

-- Instructions for uploading CSV:
-- 1. Upload your CSV file to TimescaleCloud again
-- 2. This time, make sure to upload it to the 'forex_ticks' table, not a new table
-- 3. The columns should map as follows:
--    CSV columns → forex_ticks columns
--    time → time
--    symbol → symbol
--    bid → bid
--    ask → ask
--    bid_size → bid_size
--    ask_size → ask_size
--    source → source
--    (spread and mid_price are auto-calculated)

-- After upload, test with:
-- SELECT COUNT(*) FROM forex_ticks;
-- SELECT * FROM forex_candles_1m WHERE symbol = 'EURUSD' ORDER BY time DESC LIMIT 10;