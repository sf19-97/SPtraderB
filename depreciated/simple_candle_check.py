#!/usr/bin/env python3
"""
Simple script to check 1h vs 4h candle alignment
"""
import psycopg2
import pandas as pd
from datetime import datetime, timedelta

DB_URL = "postgresql://postgres@localhost:5432/forex_trading"

def check_alignment():
    conn = psycopg2.connect(DB_URL)
    
    # Get some sample data for comparison
    query = """
    WITH hour_data AS (
        SELECT 
            time,
            symbol,
            open,
            high,
            low,
            close,
            tick_count,
            -- Extract the 4-hour period this 1h candle belongs to
            date_trunc('day', time) + 
            interval '4 hours' * (EXTRACT(hour FROM time)::int / 4) as h4_period
        FROM forex_candles_1h
        WHERE symbol = 'EURUSD'
        AND time >= '2024-05-01'
        AND time < '2024-05-02'
        ORDER BY time
    ),
    h4_data AS (
        SELECT 
            time,
            symbol,
            open,
            high,
            low,
            close,
            tick_count
        FROM forex_candles_4h
        WHERE symbol = 'EURUSD'
        AND time >= '2024-05-01'
        AND time < '2024-05-02'
        ORDER BY time
    )
    SELECT * FROM hour_data
    """
    
    df_1h = pd.read_sql(query, conn)
    
    # Get 4h data
    query_4h = """
    SELECT 
        time,
        symbol,
        open,
        high,
        low,
        close,
        tick_count
    FROM forex_candles_4h
    WHERE symbol = 'EURUSD'
    AND time >= '2024-05-01'
    AND time < '2024-05-02'
    ORDER BY time
    """
    
    df_4h = pd.read_sql(query_4h, conn)
    
    print("\n1-Hour Candles:")
    print(df_1h[['time', 'open', 'high', 'low', 'close', 'tick_count']])
    
    print("\n4-Hour Candles:")
    print(df_4h[['time', 'open', 'high', 'low', 'close', 'tick_count']])
    
    # Group 1h candles by 4h period and check alignment
    print("\nAlignment Check:")
    for _, h4_candle in df_4h.iterrows():
        h4_time = h4_candle['time']
        h4_end = h4_time + timedelta(hours=4)
        
        # Get corresponding 1h candles
        mask = (df_1h['time'] >= h4_time) & (df_1h['time'] < h4_end)
        h1_candles = df_1h[mask]
        
        if len(h1_candles) > 0:
            print(f"\n4H Candle at {h4_time}:")
            print(f"  4H Open: {h4_candle['open']:.5f}, 1H First Open: {h1_candles.iloc[0]['open']:.5f}")
            print(f"  4H Close: {h4_candle['close']:.5f}, 1H Last Close: {h1_candles.iloc[-1]['close']:.5f}")
            print(f"  4H High: {h4_candle['high']:.5f}, 1H Max High: {h1_candles['high'].max():.5f}")
            print(f"  4H Low: {h4_candle['low']:.5f}, 1H Min Low: {h1_candles['low'].min():.5f}")
            print(f"  4H Ticks: {h4_candle['tick_count']}, 1H Sum Ticks: {h1_candles['tick_count'].sum()}")
            
            # Check for misalignments
            if abs(h4_candle['open'] - h1_candles.iloc[0]['open']) > 0.00001:
                print("  ⚠️  OPEN MISMATCH!")
            if abs(h4_candle['close'] - h1_candles.iloc[-1]['close']) > 0.00001:
                print("  ⚠️  CLOSE MISMATCH!")
            if abs(h4_candle['high'] - h1_candles['high'].max()) > 0.00001:
                print("  ⚠️  HIGH MISMATCH!")
            if abs(h4_candle['low'] - h1_candles['low'].min()) > 0.00001:
                print("  ⚠️  LOW MISMATCH!")
    
    conn.close()

if __name__ == "__main__":
    check_alignment()