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
        fast_above_prev = fast_above.shift(1).fillna(False)
        
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
                golden_cross_confirmed = golden_cross_confirmed & fast_above.shift(-i).fillna(False)
                death_cross_confirmed = death_cross_confirmed & ~fast_above.shift(-i).fillna(True)
            
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
    
    # Check if we should use a dataset
    dataset_name = os.environ.get('TEST_DATASET')
    
    if dataset_name:
        # Load real data from parquet
        try:
            import pyarrow.parquet as pq
            
            # Navigate to workspace/data directory
            workspace_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            data_path = os.path.join(workspace_dir, 'data', dataset_name)
            
            if os.path.exists(data_path):
                print(f"Loading dataset: {dataset_name}")
                
                # Read parquet file
                table = pq.read_table(data_path)
                test_data = table.to_pandas()
                
                # Ensure we have the right columns
                if 'timestamp' in test_data.columns:
                    test_data['date'] = pd.to_datetime(test_data['timestamp'])
                elif 'time' in test_data.columns:
                    test_data['date'] = pd.to_datetime(test_data['time'])
                
                print(f"Loaded {len(test_data)} rows of data")
                
                # Calculate indicators on real data
                sys.path.append(workspace_dir)
                from core.indicators.trend.sma import SMA
                
                sma_fast = SMA(period=20)
                sma_slow = SMA(period=50)
                
                fast_result = sma_fast.calculate(test_data)
                slow_result = sma_slow.calculate(test_data)
                
                ma_fast = fast_result['sma']
                ma_slow = slow_result['sma']
            else:
                print(f"Dataset not found: {data_path}")
                sys.exit(1)
        except ImportError as e:
            print(f"Error importing required modules: {e}")
            print("Falling back to synthetic data")
            dataset_name = None
        except Exception as e:
            print(f"Error loading dataset: {e}")
            print("Falling back to synthetic data")
            dataset_name = None
    
    # If no dataset, use synthetic data
    if not dataset_name:
        # Create test data
        dates = pd.date_range('2024-01-01', periods=100, freq='D')
        
        # Create realistic forex price data
        price = 1.0850  # Realistic EURUSD starting price
        prices = []
        for i in range(100):
            if i < 30:
                price += np.random.normal(0.0005, 0.0003)  # Uptrend (5 pips average)
            elif i < 60:
                price += np.random.normal(-0.0005, 0.0003)  # Downtrend
            else:
                price += np.random.normal(0.0005, 0.0003)  # Uptrend again
            prices.append(price)
        
        test_data = pd.DataFrame({
            'date': dates,
            'close': prices
        })
        
        # Simulate moving averages
        ma_fast = pd.Series(prices).rolling(20).mean()
        ma_slow = pd.Series(prices).rolling(50).mean()
    
    indicators = {
        'ma_fast': ma_fast,
        'ma_slow': ma_slow
    }
    
    # Test signal
    signal = MAcrossover(min_separation=0.0001, confirmation_bars=1)
    results = signal.evaluate(test_data, indicators)
    
    # Find crossover points
    crossovers = results[results['signal']]
    
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
    if dataset_name and 'open' in test_data.columns:
        # Use real OHLC data
        viz_data = {
            "time": test_data['date'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist() if 'date' in test_data else test_data.index.strftime('%Y-%m-%d %H:%M:%S').tolist(),
            "open": test_data['open'].tolist(),
            "high": test_data['high'].tolist(),
            "low": test_data['low'].tolist(),
            "close": test_data['close'].tolist(),
            "indicators": {
                "ma_fast": [v if not pd.isna(v) else None for v in ma_fast],
                "ma_slow": [v if not pd.isna(v) else None for v in ma_slow]
            },
            "signals": {
                "crossovers": crossovers.index.tolist(),
                "types": results.loc[crossovers.index, 'crossover_type'].tolist() if len(crossovers) > 0 else []
            }
        }
    else:
        # Synthetic data - create OHLC from close prices
        if dataset_name:
            # No OHLC columns, but we have real close data
            prices = test_data['close'].tolist()
            dates = test_data['date']
        else:
            # Pure synthetic data
            dates = test_data['date']
            prices = test_data['close'].tolist()
        
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