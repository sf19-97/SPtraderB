from sqlalchemy import create_engine
import pandas as pd

# Connect to database
engine = create_engine("postgresql://postgres@localhost:5432/forex_trading")

# Check tick count
tick_count = pd.read_sql("SELECT COUNT(*) as count FROM forex_ticks", engine)
print(f"Total ticks in database: {tick_count['count'][0]}")

# Check date range
date_range = pd.read_sql("""
    SELECT 
        MIN(time) as earliest,
        MAX(time) as latest,
        COUNT(DISTINCT DATE(time)) as days
    FROM forex_ticks
""", engine)
print(f"\nDate range: {date_range['earliest'][0]} to {date_range['latest'][0]}")
print(f"Days with data: {date_range['days'][0]}")

# Show sample data
sample = pd.read_sql("SELECT * FROM forex_ticks ORDER BY time DESC LIMIT 5", engine)
print("\nSample data:")
print(sample)

# Check 5-minute candles
candles = pd.read_sql("""
    SELECT COUNT(*) as count 
    FROM forex_candles_5m 
    WHERE time >= '2024-01-01'
""", engine)
print(f"\n5-minute candles: {candles['count'][0]}")