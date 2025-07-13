-- Monitor Bitcoin continuous aggregate refresh cascade
-- Shows the latest data in each aggregate to verify proper refresh order

WITH latest_data AS (
    SELECT 
        'bitcoin_candles_1m' as aggregate_name,
        1 as sort_order,
        MAX(time) as latest_candle,
        COUNT(*) as total_candles
    FROM bitcoin_candles_1m
    
    UNION ALL
    
    SELECT 
        'bitcoin_candles_5m' as aggregate_name,
        2 as sort_order,
        MAX(time) as latest_candle,
        COUNT(*) as total_candles
    FROM bitcoin_candles_5m
    
    UNION ALL
    
    SELECT 
        'bitcoin_candles_15m' as aggregate_name,
        3 as sort_order,
        MAX(time) as latest_candle,
        COUNT(*) as total_candles
    FROM bitcoin_candles_15m
    
    UNION ALL
    
    SELECT 
        'bitcoin_candles_1h' as aggregate_name,
        4 as sort_order,
        MAX(time) as latest_candle,
        COUNT(*) as total_candles
    FROM bitcoin_candles_1h
    
    UNION ALL
    
    SELECT 
        'bitcoin_candles_4h' as aggregate_name,
        5 as sort_order,
        MAX(time) as latest_candle,
        COUNT(*) as total_candles
    FROM bitcoin_candles_4h
    
    UNION ALL
    
    SELECT 
        'bitcoin_candles_12h' as aggregate_name,
        6 as sort_order,
        MAX(time) as latest_candle,
        COUNT(*) as total_candles
    FROM bitcoin_candles_12h
)
SELECT 
    aggregate_name,
    latest_candle,
    NOW() - latest_candle as data_lag,
    total_candles
FROM latest_data
ORDER BY sort_order;