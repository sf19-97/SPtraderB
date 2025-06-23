"""
Simple Moving Average (SMA) Indicator
"""
import pandas as pd
import numpy as np
from typing import Optional
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from core.base.indicator import Indicator

__metadata_version__ = 1
__metadata__ = {
    'name': 'sma',
    'category': 'trend',
    'version': '1.0.0',
    'description': 'Simple Moving Average - smooths price data to identify trends',
    'author': 'system',
    'inputs': ['close'],
    'outputs': ['sma'],
    'parameters': {
        'period': {
            'type': 'int',
            'default': 20,
            'min': 2,
            'max': 200,
            'description': 'Number of periods for averaging'
        },
        'source': {
            'type': 'str',
            'default': 'close',
            'options': ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'],
            'description': 'Price source for calculation'
        }
    },
    'performance_budget': {
        'max_ms': 0.5,
        'complexity': 'O(n)'
    },
    'min_lookback': 20,
    'tags': ['trend', 'moving_average', 'smooth', 'basic']
}

class SMA(Indicator):
    """
    Simple Moving Average (SMA) - A trend-following indicator that smooths
    price action by creating a constantly updated average price.
    
    The SMA is calculated by adding up the last 'n' period's prices and 
    then dividing by 'n'. Each period carries equal weight.
    
    Common uses:
    - Trend identification (price above SMA = uptrend)
    - Support/resistance levels
    - Crossover signals with multiple SMAs
    """
    
    def __init__(self, period: int = 20, source: str = 'close'):
        super().__init__()
        self.period = period
        self.source = source
        
    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate SMA values
        
        Args:
            data: DataFrame with OHLC columns
            
        Returns:
            DataFrame with 'sma' column
        """
        # Get the source price
        if self.source == 'hl2':
            price = (data['high'] + data['low']) / 2
        elif self.source == 'hlc3':
            price = (data['high'] + data['low'] + data['close']) / 3
        elif self.source == 'ohlc4':
            price = (data['open'] + data['high'] + data['low'] + data['close']) / 4
        else:
            price = data[self.source]
        
        # Calculate simple moving average
        sma = price.rolling(window=self.period, min_periods=1).mean()
        
        return pd.DataFrame({'sma': sma})
    
    @property
    def metadata(self):
        return __metadata__

# Test function for standalone execution
if __name__ == "__main__":
    print(f"Testing {__metadata__['name']} indicator...")
    
    # Import the unified data loader
    from core.data.loader import load_data_from_env
    
    # Load data using the unified interface
    test_data = load_data_from_env()
    
    print(f"Loaded {len(test_data)} rows of data")
    print(f"Date range: {test_data.index[0]} to {test_data.index[-1]}")
    
    # Calculate SMA
    indicator = SMA(period=20)
    result = indicator.calculate(test_data)
    
    # Display results
    print(f"\nFirst 5 SMA values:")
    print(result.head())
    
    print(f"\nLast 5 SMA values:")
    print(result.tail())
    
    print(f"\nSMA Statistics:")
    print(f"Mean: {result['sma'].mean():.2f}")
    print(f"Std Dev: {result['sma'].std():.2f}")
    print(f"Min: {result['sma'].min():.2f}")
    print(f"Max: {result['sma'].max():.2f}")
    
    # Performance test
    import time
    start = time.perf_counter()
    for _ in range(1000):
        indicator.calculate(test_data)
    elapsed = (time.perf_counter() - start) / 1000 * 1000  # ms per calculation
    
    print(f"\nPerformance: {elapsed:.3f}ms per calculation")
    print(f"✓ Meets performance budget: {elapsed < __metadata__['performance_budget']['max_ms']}")