"""
EMA Crossover Signal - Generates buy/sell signals when fast EMA crosses slow EMA
"""
import pandas as pd
import numpy as np
import json
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

__metadata_version__ = 2
__metadata__ = {
    'name': 'ema_crossover',
    'version': '1.0.0',
    'description': 'Generates signals when fast EMA crosses slow EMA',
    'author': 'system',
    'lookback_required': 100,
    'required_indicators': [
        {
            'name': 'ema_fast',
            'type': 'ema',
            'parameters': {'period': 12}
        },
        {
            'name': 'ema_slow', 
            'type': 'ema',
            'parameters': {'period': 26}
        }
    ],
    'signal_types': ['golden_cross', 'death_cross'],
    'parameters': {
        'fast_period': {
            'type': 'int',
            'default': 12,
            'min': 5,
            'max': 50,
            'description': 'Period for fast EMA'
        },
        'slow_period': {
            'type': 'int',
            'default': 26,
            'min': 10,
            'max': 200,
            'description': 'Period for slow EMA'
        }
    }
}

def find_crossovers(fast_ema, slow_ema):
    """Find where fast EMA crosses slow EMA"""
    # Create a series indicating when fast is above slow
    fast_above = fast_ema > slow_ema
    
    # Find where the relationship changes
    crossovers = fast_above != fast_above.shift(1)
    
    # Create a DataFrame with the results
    df = pd.DataFrame(index=fast_ema.index)
    df['signal'] = 0
    df['signal_type'] = ''
    
    # Golden cross: fast crosses above slow (bullish)
    golden_cross = crossovers & fast_above
    df.loc[golden_cross, 'signal'] = 1
    df.loc[golden_cross, 'signal_type'] = 'golden_cross'
    
    # Death cross: fast crosses below slow (bearish)
    death_cross = crossovers & ~fast_above
    df.loc[death_cross, 'signal'] = -1
    df.loc[death_cross, 'signal_type'] = 'death_cross'
    
    return df

def generate_signals(indicators, parameters=None):
    """Generate trading signals from EMA crossovers"""
    # Get EMAs from indicators
    ema_fast = indicators.get('ema_fast')
    ema_slow = indicators.get('ema_slow')
    
    if ema_fast is None or ema_slow is None:
        raise ValueError("Required indicators 'ema_fast' and 'ema_slow' not found")
    
    # Find crossovers
    signals_df = find_crossovers(ema_fast, ema_slow)
    
    # Convert to signal events
    signals = []
    signal_rows = signals_df[signals_df['signal'] != 0]
    
    for idx, row in signal_rows.iterrows():
        signal = {
            'timestamp': idx.isoformat() if hasattr(idx, 'isoformat') else str(idx),
            'signal_type': row['signal_type'],
            'strength': 1.0,
            'price': float(indicators.get('close', pd.Series()).get(idx, 0)),
            'metadata': {
                'ema_fast': float(ema_fast.get(idx, 0)),
                'ema_slow': float(ema_slow.get(idx, 0)),
                'crossover_delta': float(ema_fast.get(idx, 0) - ema_slow.get(idx, 0)),
                'crossover_type': row['signal_type']
            }
        }
        signals.append(signal)
    
    return signals

# Standalone execution for testing
if __name__ == "__main__":
    from core.data.loader import load_data_from_env
    from core.indicators.trend.ema import EMA
    
    # Load test data
    data = load_data_from_env()
    print(f"Loaded {len(data)} candles")
    
    # Calculate indicators
    ema_fast_indicator = EMA(period=12)
    ema_slow_indicator = EMA(period=26)
    
    ema_fast_result = ema_fast_indicator.calculate(data)
    ema_slow_result = ema_slow_indicator.calculate(data)
    
    # Prepare indicators dict
    indicators = {
        'ema_fast': ema_fast_result['ema'],
        'ema_slow': ema_slow_result['ema'],
        'close': data['close']
    }
    
    # Generate signals
    signals = generate_signals(indicators)
    
    print(f"\nGenerated {len(signals)} signals")
    
    # Show first few signals
    for i, signal in enumerate(signals[:5]):
        print(f"\nSignal {i+1}:")
        print(f"  Time: {signal['timestamp']}")
        print(f"  Type: {signal['signal_type']}")
        print(f"  Price: {signal['price']:.5f}")
        print(f"  EMA Fast: {signal['metadata']['ema_fast']:.5f}")
        print(f"  EMA Slow: {signal['metadata']['ema_slow']:.5f}")
    
    # Output signals
    print("\nSIGNAL_OUTPUT_START")
    print(json.dumps(signals))
    print("SIGNAL_OUTPUT_END")
    
    # Prepare chart data
    crossover_indices = []
    crossover_types = []
    
    crossovers_df = find_crossovers(ema_fast_result['ema'], ema_slow_result['ema'])
    for i, (idx, row) in enumerate(crossovers_df[crossovers_df['signal'] != 0].iterrows()):
        crossover_indices.append(i)
        crossover_types.append(row['signal_type'])
    
    chart_data = {
        "time": data.index.strftime('%Y-%m-%d %H:%M:%S').tolist(),
        "open": data['open'].tolist(),
        "high": data['high'].tolist(),
        "low": data['low'].tolist(),
        "close": data['close'].tolist(),
        "indicators": {
            "ema_fast": ema_fast_result['ema'].tolist(),
            "ema_slow": ema_slow_result['ema'].tolist()
        },
        "signals": {
            "crossovers": crossover_indices,
            "types": crossover_types
        }
    }
    
    print("\nCHART_DATA_START")
    print(json.dumps(chart_data))
    print("CHART_DATA_END")