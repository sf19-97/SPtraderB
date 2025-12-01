#!/usr/bin/env python3
"""
Simple Moving Average indicator for testing orchestrator execution
"""
import os
import json
import pandas as pd

def main():
    # Get candle data from environment
    candle_data = json.loads(os.environ.get('CANDLE_DATA', '[]'))
    current_index = int(os.environ.get('CURRENT_INDEX', '0'))
    
    if not candle_data:
        print("No candle data provided")
        return
    
    # Convert to DataFrame
    df = pd.DataFrame(candle_data)
    if 'time' in df.columns:
        df['time'] = pd.to_datetime(df['time'], unit='s')
        df.set_index('time', inplace=True)
    
    # Calculate SMA
    period = 20
    sma_values = df['close'].rolling(window=period).mean()
    
    # Get the last few values up to current index
    last_values = sma_values.iloc[max(0, current_index-2):current_index+1].dropna().tolist()
    current_value = sma_values.iloc[current_index] if current_index < len(sma_values) else float('nan')
    
    # Output in expected format
    print("INDICATOR_START")
    print(json.dumps({
        "values": last_values,
        "current": current_value if pd.notna(current_value) else 0.0
    }))
    print("INDICATOR_END")

if __name__ == "__main__":
    main()