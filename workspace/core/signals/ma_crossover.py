"""
Moving Average Crossover Signal - Detects when fast MA crosses above slow MA
"""
import pandas as pd
from typing import List, Dict, Any
from core.base.signal import Signal

__metadata_version__ = 2  # New version for enhanced metadata
__metadata__ = {
    'name': 'ma_crossover',
    'description': 'Detects golden cross (bullish) and death cross (bearish) signals',
    'category': 'trend_following',
    'version': '1.0.0',
    'author': 'system',
    'status': 'ready',
    'lookback_required': 100,  # Need 2x the slow MA period for proper warmup
    'required_indicators': [
        {
            'name': 'ma_fast',
            'type': 'sma',  # References core.indicators.trend.sma
            'params': {'period': 20, 'source': 'close'}
        },
        {
            'name': 'ma_slow', 
            'type': 'sma',
            'params': {'period': 50, 'source': 'close'}
        }
    ],
    'outputs': ['signal', 'signal_strength', 'crossover_type'],
    'parameters': {
        'min_separation': {
            'type': 'float',
            'default': 0.0002,
            'min': 0.0,
            'max': 0.01,
            'description': 'Minimum % separation to confirm crossover'
        },
        'confirmation_bars': {
            'type': 'int',
            'default': 1,
            'min': 1,
            'max': 5,
            'description': 'Bars to confirm crossover'
        }
    },
    'tags': ['trend', 'moving_average', 'crossover', 'golden_cross', 'death_cross']
}

class MAcrossover(Signal):
    """
    Moving Average Crossover Signal
    
    Generates trading signals when a fast moving average crosses above (golden cross)
    or below (death cross) a slow moving average. Includes optional filters for
    minimum separation and confirmation bars.
    
    Outputs:
    - signal: Boolean series indicating crossover events
    - signal_strength: Normalized separation between MAs (0-1)
    - crossover_type: 'golden_cross', 'death_cross', or 'none'
    """
    
    def __init__(self, min_separation: float = 0.0002, confirmation_bars: int = 1):
        self.min_separation = min_separation
        self.confirmation_bars = confirmation_bars
    
    @property
    def required_indicators(self) -> List[Any]:
        """Return enhanced metadata for required indicators"""
        return __metadata__['required_indicators']
    
    def evaluate(self, data: pd.DataFrame, indicators: Dict[str, pd.Series]) -> pd.DataFrame:
        """
        Evaluate signal conditions
        
        Args:
            data: OHLC DataFrame
            indicators: Dictionary with 'ma_fast' and 'ma_slow' series
            
        Returns:
            DataFrame with signal, signal_strength, and crossover_type columns
        """
        if 'ma_fast' not in indicators or 'ma_slow' not in indicators:
            raise ValueError("Both ma_fast and ma_slow indicators are required")
        
        fast = indicators['ma_fast']
        slow = indicators['ma_slow']
        
        # Calculate crossover points
        fast_above = fast > slow
        fast_above_prev = fast_above.shift(1).fillna(False).astype(bool)
        
        # Detect crossovers
        golden_cross = fast_above & ~fast_above_prev  # Fast crosses above slow
        death_cross = ~fast_above & fast_above_prev   # Fast crosses below slow
        
        # Calculate separation percentage
        separation = abs(fast - slow) / slow
        
        # Apply minimum separation filter
        if self.min_separation > 0:
            valid_separation = separation >= self.min_separation
            golden_cross = golden_cross & valid_separation
            death_cross = death_cross & valid_separation
        
        # Apply confirmation bars filter
        if self.confirmation_bars > 1:
            # Require the crossover to persist for N bars
            golden_cross_confirmed = golden_cross.copy()
            death_cross_confirmed = death_cross.copy()
            
            for i in range(1, self.confirmation_bars):
                # Check if fast is still above/below slow after i bars
                golden_cross_confirmed = golden_cross_confirmed & fast_above.shift(-i).fillna(False).astype(bool)
                death_cross_confirmed = death_cross_confirmed & ~fast_above.shift(-i).fillna(True).astype(bool)
            
            golden_cross = golden_cross_confirmed
            death_cross = death_cross_confirmed
        
        # Calculate signal strength (normalized separation)
        # Normalize to 0-1 range based on typical separation values
        signal_strength = (separation / 0.01).clip(0, 1)
        
        # Determine crossover type
        crossover_type = pd.Series('none', index=data.index)
        crossover_type[golden_cross] = 'golden_cross'
        crossover_type[death_cross] = 'death_cross'
        
        # Combine all signals
        signal = golden_cross | death_cross
        
        return pd.DataFrame({
            'signal': signal,
            'signal_strength': signal_strength,
            'crossover_type': crossover_type
        })
    
    @property
    def metadata(self) -> Dict[str, Any]:
        return __metadata__

# Test the signal
if __name__ == "__main__":
    import numpy as np
    import os
    import sys
    
    # Add workspace to path
    workspace_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sys.path.append(workspace_dir)
    
    # Import the unified data loader
    from core.data.loader import load_data_from_env
    
    # Load data using the unified interface
    test_data = load_data_from_env()
    
    # The loader returns a DataFrame with a datetime index
    # Add a date column for compatibility
    test_data['date'] = test_data.index
    
    print(f"Loaded {len(test_data)} rows of data")
    print(f"Date range: {test_data.index[0]} to {test_data.index[-1]}")
    
    # Check if we have real OHLC data or just close prices
    has_ohlc = all(col in test_data.columns for col in ['open', 'high', 'low', 'close'])
    
    if has_ohlc:
        # Calculate indicators on real OHLC data
        from core.indicators.trend.sma import SMA
        
        sma_fast = SMA(period=20)
        sma_slow = SMA(period=50)
        
        fast_result = sma_fast.calculate(test_data)
        slow_result = sma_slow.calculate(test_data)
        
        ma_fast = fast_result['sma']
        ma_slow = slow_result['sma']
    else:
        # If only close prices, calculate MAs directly
        ma_fast = test_data['close'].rolling(20).mean()
        ma_slow = test_data['close'].rolling(50).mean()
    
    indicators = {
        'ma_fast': ma_fast,
        'ma_slow': ma_slow
    }
    
    # Test signal
    signal = MAcrossover(min_separation=0.0001, confirmation_bars=1)
    results = signal.evaluate(test_data, indicators)
    
    # Find crossover points
    crossovers = results[results['signal']]
    
    # Only print debug output if DEBUG_SIGNALS is set
    if os.environ.get('DEBUG_SIGNALS') == 'true':
        print(f"Signal triggered on {len(crossovers)} days")
        print("\nCrossover events:")
        for idx, row in crossovers.iterrows():
            date = test_data.loc[idx, 'date']
            cross_type = row['crossover_type']
            strength = row['signal_strength']
            print(f"{date.strftime('%Y-%m-%d')}: {cross_type} (strength: {strength:.3f})")
        
        # Print metadata
        print(f"\nMetadata version: {__metadata_version__}")
        print(f"Required indicators: {len(__metadata__['required_indicators'])}")
        for req in __metadata__['required_indicators']:
            print(f"  - {req['name']}: {req['type']} with params {req['params']}")
    
    # Output visualization data
    import json
    
    # Prepare data for visualization
    if has_ohlc:
        # Use real OHLC data
        # Convert timestamps to strings
        if 'date' in test_data.columns:
            time_series = test_data['date'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist()
        else:
            time_series = test_data.index.strftime('%Y-%m-%d %H:%M:%S').tolist()
            
        viz_data = {
            "time": time_series,
            "open": test_data['open'].tolist(),
            "high": test_data['high'].tolist(),
            "low": test_data['low'].tolist(),
            "close": test_data['close'].tolist(),
            "indicators": {
                "ma_fast": [float(v) if not pd.isna(v) else None for v in ma_fast],
                "ma_slow": [float(v) if not pd.isna(v) else None for v in ma_slow]
            },
            "signals": {
                "crossovers": [int(idx) for idx in crossovers.index.tolist()],
                "types": results.loc[crossovers.index, 'crossover_type'].tolist() if len(crossovers) > 0 else []
            }
        }
    else:
        # Create OHLC from close prices
        prices = test_data['close'].tolist()
        dates = test_data['date']
        
        # Generate realistic OHLC from close prices
        viz_data = {
            "time": dates.dt.strftime('%Y-%m-%d %H:%M:%S').tolist(),
            "open": prices,  # Using close as open for simplicity
            "high": [p + (0.0005 if p < 10 else 0.5) for p in prices],  # Adjust range based on price level
            "low": [p - (0.0005 if p < 10 else 0.5) for p in prices],
            "close": prices,
            "indicators": {
                "ma_fast": [v if not pd.isna(v) else None for v in ma_fast],
                "ma_slow": [v if not pd.isna(v) else None for v in ma_slow]
            },
            "signals": {
                "crossovers": crossovers.index.tolist(),
                "types": results.loc[crossovers.index, 'crossover_type'].tolist() if len(crossovers) > 0 else []
            }
        }
    
    print("\nCHART_DATA_START")
    print(json.dumps(viz_data))
    print("CHART_DATA_END")
    
    # Output signal events for orchestrator
    signal_events = []
    for idx, row in crossovers.iterrows():
        # Get the timestamp
        if hasattr(test_data.index, 'strftime'):
            timestamp = test_data.index[idx].strftime('%Y-%m-%dT%H:%M:%S+00:00')
        else:
            timestamp = test_data.loc[idx, 'date'].strftime('%Y-%m-%dT%H:%M:%S+00:00')
        
        signal_events.append({
            "timestamp": timestamp,
            "signal_name": "ma_crossover",
            "signal_type": row['crossover_type'],
            "strength": float(row['signal_strength']),
            "metadata": {
                "ma_fast": float(ma_fast[idx]) if not pd.isna(ma_fast[idx]) else None,
                "ma_slow": float(ma_slow[idx]) if not pd.isna(ma_slow[idx]) else None,
                "close": float(test_data.loc[idx, 'close']),
                "separation": float(abs(ma_fast[idx] - ma_slow[idx]) / ma_slow[idx]) if not pd.isna(ma_fast[idx]) and not pd.isna(ma_slow[idx]) else 0.0,
                "symbol": os.environ.get('LIVE_SYMBOL', 'EURUSD')  # Include symbol from environment
            }
        })
    
    print("\nSIGNAL_START")
    print(json.dumps(signal_events))
    print("SIGNAL_END")
    
    # Check if we're in live mode and should publish to Redis
    if os.environ.get('PUBLISH_LIVE') == 'true':
        try:
            from core.data.signal_publisher import SignalPublisher
            publisher = SignalPublisher()
            
            # Publish the latest signal if any
            if signal_events:
                latest_signal = signal_events[-1]
                success = publisher.publish_signal(
                    signal_name='ma_crossover',
                    signal_type=latest_signal['signal_type'],
                    strength=latest_signal['strength'],
                    metadata={
                        **latest_signal['metadata'],
                        'current_price': float(test_data['close'].iloc[-1])
                    }
                )
                
                if success:
                    print(f"\nPublished live signal: {latest_signal['signal_type']}")
                else:
                    print("\nFailed to publish live signal")
                    
            publisher.close()
        except Exception as e:
            print(f"\nError publishing live signal: {e}")