"""
Exponential Moving Average (EMA) Indicator
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
    'name': 'ema',
    'category': 'trend',
    'version': '1.0.0',
    'description': 'Exponential Moving Average - gives more weight to recent prices',
    'author': 'system',
    'inputs': ['close'],
    'outputs': ['ema'],
    'lookback_required': 100,  # Default to 100, but ideally should be 3-4x period for convergence
    'parameters': {
        'period': {
            'type': 'int',
            'default': 20,
            'min': 2,
            'max': 200,
            'description': 'Number of periods for EMA calculation'
        },
        'source': {
            'type': 'str',
            'default': 'close',
            'options': ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'],
            'description': 'Price source for calculation'
        },
        'smoothing': {
            'type': 'float',
            'default': 2.0,
            'min': 1.0,
            'max': 3.0,
            'description': 'Smoothing factor (default 2 for standard EMA)'
        }
    },
    'performance_budget': {
        'max_ms': 0.5,
        'complexity': 'O(n)'
    },
    'min_lookback': 20,
    'tags': ['trend', 'moving_average', 'smooth', 'exponential', 'responsive']
}

class EMA(Indicator):
    """
    Exponential Moving Average (EMA) - A type of moving average that places
    greater weight and significance on the most recent data points.
    
    Unlike the SMA which assigns equal weight to all values, the EMA gives
    more weight to recent prices, making it more responsive to new information.
    The weighting multiplier (alpha) = smoothing / (period + 1)
    
    EMA advantages over SMA:
    - More responsive to recent price changes
    - Less lag in trending markets
    - Better for short-term trading
    
    Common uses:
    - Trend identification (faster than SMA)
    - Dynamic support/resistance levels
    - Crossover signals (fast/slow EMA crosses)
    - MACD calculation (12 and 26 period EMAs)
    """
    
    def __init__(self, period: int = 20, source: str = 'close', smoothing: float = 2.0):
        super().__init__()
        self.period = period
        self.source = source
        self.smoothing = smoothing
        self.alpha = smoothing / (period + 1)
        
    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate EMA values
        
        Args:
            data: DataFrame with OHLC columns
            
        Returns:
            DataFrame with 'ema' column
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
        
        # Calculate EMA using pandas ewm
        # adjust=False uses the recursive calculation: EMA = alpha * price + (1 - alpha) * EMA_prev
        ema = price.ewm(span=self.period, adjust=False).mean()
        
        return pd.DataFrame({'ema': ema})
    
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
    
    # Calculate EMA
    indicator = EMA(period=20)
    result = indicator.calculate(test_data)
    
    # Display results
    print(f"\nFirst 5 EMA values:")
    print(result.head())
    
    print(f"\nLast 5 EMA values:")
    print(result.tail())
    
    print(f"\nEMA Statistics:")
    print(f"Mean: {result['ema'].mean():.2f}")
    print(f"Std Dev: {result['ema'].std():.2f}")
    print(f"Min: {result['ema'].min():.2f}")
    print(f"Max: {result['ema'].max():.2f}")
    
    # Compare with SMA to show responsiveness
    from core.indicators.trend.sma import SMA
    sma_indicator = SMA(period=20)
    sma_result = sma_indicator.calculate(test_data)
    
    # Calculate the difference
    ema_values = result['ema']
    sma_values = sma_result['sma']
    
    # Find where EMA leads SMA in trends
    close_prices = test_data['close']
    price_changes = close_prices.pct_change()
    
    # When price is rising, EMA should be above SMA
    rising_market = price_changes > 0
    ema_above_sma = ema_values > sma_values
    
    # Calculate responsiveness metrics
    correct_positioning = ((rising_market & ema_above_sma) | (~rising_market & ~ema_above_sma)).sum()
    total_periods = len(price_changes.dropna())
    responsiveness_score = correct_positioning / total_periods * 100 if total_periods > 0 else 0
    
    print(f"\nEMA vs SMA Comparison:")
    print(f"Average EMA-SMA difference: {(ema_values - sma_values).mean():.4f}")
    print(f"Responsiveness score: {responsiveness_score:.1f}%")
    print(f"(How often EMA is correctly positioned relative to SMA based on price direction)")
    
    # Calculate multiple EMAs for trend analysis
    ema_fast = EMA(period=12).calculate(test_data)['ema']
    ema_slow = EMA(period=26).calculate(test_data)['ema']
    
    # Find EMA crossovers
    fast_above = ema_fast > ema_slow
    crossovers = fast_above != fast_above.shift(1)
    bullish_crosses = crossovers & fast_above
    bearish_crosses = crossovers & ~fast_above
    
    print(f"\nEMA Crossover Analysis (12/26):")
    print(f"Bullish crossovers: {bullish_crosses.sum()}")
    print(f"Bearish crossovers: {bearish_crosses.sum()}")
    
    # Performance test
    import time
    start = time.perf_counter()
    for _ in range(1000):
        indicator.calculate(test_data)
    elapsed = (time.perf_counter() - start) / 1000 * 1000  # ms per calculation
    
    print(f"\nPerformance: {elapsed:.3f}ms per calculation")
    print(f"✓ Meets performance budget: {elapsed < __metadata__['performance_budget']['max_ms']}")
    
    # Output visualization data
    import json
    
    # Prepare data for visualization
    if 'date' in test_data.columns:
        time_series = test_data['date'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist()
    else:
        time_series = test_data.index.strftime('%Y-%m-%d %H:%M:%S').tolist()
    
    # Find crossover points for visualization
    crossover_events = []
    for i in range(1, len(bullish_crosses)):
        if bullish_crosses.iloc[i]:
            crossover_events.append({
                'index': i,
                'type': 'bullish_cross',
                'ema_fast': float(ema_fast.iloc[i]),
                'ema_slow': float(ema_slow.iloc[i])
            })
        elif bearish_crosses.iloc[i]:
            crossover_events.append({
                'index': i,
                'type': 'bearish_cross',
                'ema_fast': float(ema_fast.iloc[i]),
                'ema_slow': float(ema_slow.iloc[i])
            })
    
    viz_data = {
        "time": time_series,
        "open": test_data['open'].tolist() if 'open' in test_data.columns else test_data['close'].tolist(),
        "high": test_data['high'].tolist() if 'high' in test_data.columns else test_data['close'].tolist(),
        "low": test_data['low'].tolist() if 'low' in test_data.columns else test_data['close'].tolist(),
        "close": test_data['close'].tolist(),
        "indicators": {
            "ema_20": [float(v) if not pd.isna(v) else None for v in result['ema']],
            "ema_12": [float(v) if not pd.isna(v) else None for v in ema_fast],
            "ema_26": [float(v) if not pd.isna(v) else None for v in ema_slow],
            "sma_20": [float(v) if not pd.isna(v) else None for v in sma_values]  # For comparison
        },
        "signals": {
            "crossovers": crossover_events,
            "metrics": {
                "responsiveness_score": float(responsiveness_score),
                "avg_ema_sma_diff": float((ema_values - sma_values).mean())
            }
        }
    }
    
    print("\nCHART_DATA_START")
    print(json.dumps(viz_data))
    print("CHART_DATA_END")