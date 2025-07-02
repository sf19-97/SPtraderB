#!/usr/bin/env python3
"""
Vectorized backtest execution - runs all calculations in one pass
"""
import json
import sys
import os
import pandas as pd
import numpy as np
from datetime import datetime
from typing import Dict, List, Any

# Add workspace to path
workspace_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if workspace_dir not in sys.path:
    sys.path.insert(0, workspace_dir)

def calculate_sma(data: pd.Series, period: int) -> pd.Series:
    """Simple moving average"""
    return data.rolling(window=period, min_periods=1).mean()

def find_crossovers(fast: pd.Series, slow: pd.Series) -> pd.DataFrame:
    """Find crossover points between two series"""
    # Current position
    fast_above = fast > slow
    # Previous position
    fast_above_prev = fast_above.shift(1).fillna(False)
    
    # Detect crossovers
    golden_cross = fast_above & ~fast_above_prev  # Fast crosses above slow
    death_cross = ~fast_above & fast_above_prev   # Fast crosses below slow
    
    # Create result DataFrame
    result = pd.DataFrame(index=fast.index)
    result['signal'] = 0
    result.loc[golden_cross, 'signal'] = 1   # Buy signal
    result.loc[death_cross, 'signal'] = -1   # Sell signal
    result['signal_type'] = 'none'
    result.loc[golden_cross, 'signal_type'] = 'golden_cross'
    result.loc[death_cross, 'signal_type'] = 'death_cross'
    
    return result

def run_vectorized_backtest(candles: List[Dict], strategy_config: Dict) -> Dict:
    """
    Run entire backtest in one vectorized pass
    """
    # Convert to DataFrame
    df = pd.DataFrame(candles)
    df['time'] = pd.to_datetime(df['time'], unit='s')
    df.set_index('time', inplace=True)
    
    # Extract strategy parameters
    indicators = {}
    signals = []
    
    # Calculate indicators (example for MA crossover)
    if 'ma_crossover' in str(strategy_config):
        # Calculate SMAs
        indicators['ma_fast'] = calculate_sma(df['close'], 20)
        indicators['ma_slow'] = calculate_sma(df['close'], 50)
        
        # Find crossovers
        crossovers = find_crossovers(indicators['ma_fast'], indicators['ma_slow'])
        
        # Extract signal events
        signal_df = crossovers[crossovers['signal'] != 0]
        
        for idx, row in signal_df.iterrows():
            # Ensure timestamp has timezone info (UTC)
            if idx.tz is None:
                timestamp = idx.tz_localize('UTC')
            else:
                timestamp = idx.tz_convert('UTC')
                
            signals.append({
                'timestamp': timestamp.isoformat(),
                'signal_type': row['signal_type'],
                'strength': 1.0,
                'price': float(df.loc[idx, 'close']),
                'metadata': {
                    'ma_fast': float(indicators['ma_fast'].loc[idx]),
                    'ma_slow': float(indicators['ma_slow'].loc[idx])
                }
            })
    
    # Prepare indicator data for chart (last 100 points for efficiency)
    chart_indicators = {}
    for name, series in indicators.items():
        # Convert to list, replacing NaN with None
        values = [None if pd.isna(v) else float(v) for v in series]
        chart_indicators[name] = values
    
    return {
        'signals': signals,
        'indicators': chart_indicators,
        'stats': {
            'total_candles': len(df),
            'total_signals': len(signals),
            'calculation_time_ms': 0  # Will be set by wrapper
        }
    }

if __name__ == "__main__":
    # Read input from stdin
    input_data = json.loads(sys.stdin.read())
    
    start_time = datetime.now()
    
    # Run backtest
    result = run_vectorized_backtest(
        input_data['candles'],
        input_data.get('strategy_config', {})
    )
    
    # Add timing
    result['stats']['calculation_time_ms'] = (datetime.now() - start_time).total_seconds() * 1000
    
    # Output result
    print(json.dumps(result))