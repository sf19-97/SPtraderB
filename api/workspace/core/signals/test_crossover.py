#!/usr/bin/env python3
"""
Test crossover signal for orchestrator execution
"""
import os
import json
import pandas as pd
from datetime import datetime

def main():
    # Get candle data from environment
    candle_data = json.loads(os.environ.get('CANDLE_DATA', '[]'))
    current_index = int(os.environ.get('CURRENT_INDEX', '0'))
    
    if not candle_data or current_index < 1:
        print("SIGNAL_START")
        print("[]")
        print("SIGNAL_END")
        return
    
    # Convert to DataFrame
    df = pd.DataFrame(candle_data)
    if 'time' in df.columns:
        df['time'] = pd.to_datetime(df['time'], unit='s')
    
    # Calculate simple MAs
    fast_period = 10
    slow_period = 20
    
    df['fast_ma'] = df['close'].rolling(window=fast_period).mean()
    df['slow_ma'] = df['close'].rolling(window=slow_period).mean()
    
    # Check for crossover at current index
    signals = []
    
    if current_index >= slow_period:
        current_fast = df['fast_ma'].iloc[current_index]
        current_slow = df['slow_ma'].iloc[current_index]
        prev_fast = df['fast_ma'].iloc[current_index - 1]
        prev_slow = df['slow_ma'].iloc[current_index - 1]
        
        # Golden cross
        if prev_fast <= prev_slow and current_fast > current_slow:
            signals.append({
                "timestamp": df['time'].iloc[current_index].isoformat() + "Z",
                "signal_type": "golden_cross",
                "strength": 0.75,
                "metadata": {
                    "fast_ma": current_fast,
                    "slow_ma": current_slow
                }
            })
        
        # Death cross
        elif prev_fast >= prev_slow and current_fast < current_slow:
            signals.append({
                "timestamp": df['time'].iloc[current_index].isoformat() + "Z",
                "signal_type": "death_cross",
                "strength": 0.75,
                "metadata": {
                    "fast_ma": current_fast,
                    "slow_ma": current_slow
                }
            })
    
    # Output signals
    print("SIGNAL_START")
    print(json.dumps(signals))
    print("SIGNAL_END")

if __name__ == "__main__":
    main()