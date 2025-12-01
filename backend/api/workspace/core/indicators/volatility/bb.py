"""
Bollinger Bands (BB) Indicator
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
    'name': 'bb',
    'category': 'volatility',
    'version': '1.0.0',
    'description': 'Bollinger Bands - volatility bands placed above and below a moving average',
    'author': 'system',
    'inputs': ['close'],
    'outputs': ['upper', 'middle', 'lower', 'bandwidth', 'percent_b'],
    'lookback_required': 50,  # Default to 50, but ideally should be 2x period
    'parameters': {
        'period': {
            'type': 'int',
            'default': 20,
            'min': 5,
            'max': 200,
            'description': 'Number of periods for moving average and standard deviation'
        },
        'std_dev': {
            'type': 'float',
            'default': 2.0,
            'min': 0.5,
            'max': 5.0,
            'description': 'Number of standard deviations for bands'
        },
        'source': {
            'type': 'str',
            'default': 'close',
            'options': ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'],
            'description': 'Price source for calculation'
        }
    },
    'performance_budget': {
        'max_ms': 1.0,
        'complexity': 'O(n)'
    },
    'min_lookback': 20,
    'tags': ['volatility', 'bands', 'mean_reversion', 'overbought_oversold']
}

class BB(Indicator):
    """
    Bollinger Bands (BB) - A volatility indicator that creates bands around
    a simple moving average based on standard deviation.
    
    Developed by John Bollinger, these bands automatically widen when volatility
    increases and narrow when volatility decreases. The bands are typically set
    2 standard deviations away from a 20-period simple moving average.
    
    Band interpretations:
    - Price at upper band: Potentially overbought
    - Price at lower band: Potentially oversold
    - Bands squeezing: Low volatility, potential breakout coming
    - Bands expanding: High volatility, trend may be starting
    
    Common uses:
    - Overbought/oversold identification
    - Volatility measurement
    - Trend identification (price walking the bands)
    - Mean reversion strategies
    - Breakout strategies (Bollinger Squeeze)
    """
    
    def __init__(self, period: int = 20, std_dev: float = 2.0, source: str = 'close'):
        super().__init__()
        self.period = period
        self.std_dev = std_dev
        self.source = source
        
    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate Bollinger Bands values
        
        Args:
            data: DataFrame with OHLC columns
            
        Returns:
            DataFrame with 'upper', 'middle', 'lower', 'bandwidth', 'percent_b' columns
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
        
        # Calculate middle band (SMA)
        middle = price.rolling(window=self.period, min_periods=1).mean()
        
        # Calculate standard deviation
        std = price.rolling(window=self.period, min_periods=1).std()
        
        # Calculate bands
        upper = middle + (std * self.std_dev)
        lower = middle - (std * self.std_dev)
        
        # Calculate bandwidth (measure of volatility)
        # Bandwidth = (Upper Band - Lower Band) / Middle Band
        bandwidth = (upper - lower) / middle
        bandwidth = bandwidth.fillna(0)  # Handle division by zero
        
        # Calculate %B (position within bands)
        # %B = (Price - Lower Band) / (Upper Band - Lower Band)
        band_width = upper - lower
        percent_b = pd.Series(0.5, index=data.index)  # Default to middle
        mask = band_width != 0
        percent_b[mask] = (price[mask] - lower[mask]) / band_width[mask]
        
        return pd.DataFrame({
            'upper': upper,
            'middle': middle,
            'lower': lower,
            'bandwidth': bandwidth,
            'percent_b': percent_b
        })
    
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
    
    # Calculate Bollinger Bands
    indicator = BB(period=20, std_dev=2.0)
    result = indicator.calculate(test_data)
    
    # Display results
    print(f"\nFirst 5 BB values:")
    print(result.head())
    
    print(f"\nLast 5 BB values:")
    print(result.tail())
    
    print(f"\nBollinger Bands Statistics:")
    print(f"Middle (SMA) Mean: {result['middle'].mean():.2f}")
    print(f"Average Bandwidth: {result['bandwidth'].mean():.4f}")
    print(f"Bandwidth Std Dev: {result['bandwidth'].std():.4f}")
    print(f"Min Bandwidth: {result['bandwidth'].min():.4f}")
    print(f"Max Bandwidth: {result['bandwidth'].max():.4f}")
    
    # Analyze %B distribution
    percent_b_values = result['percent_b'].dropna()
    oversold = (percent_b_values < 0).sum()  # Below lower band
    overbought = (percent_b_values > 1).sum()  # Above upper band
    in_bands = ((percent_b_values >= 0) & (percent_b_values <= 1)).sum()
    
    print(f"\n%B Distribution:")
    print(f"Below lower band (<0): {oversold} periods ({oversold/len(percent_b_values)*100:.1f}%)")
    print(f"Within bands (0-1): {in_bands} periods ({in_bands/len(percent_b_values)*100:.1f}%)")
    print(f"Above upper band (>1): {overbought} periods ({overbought/len(percent_b_values)*100:.1f}%)")
    
    # Find Bollinger Squeeze periods (low volatility)
    bandwidth_series = result['bandwidth'].dropna()
    bandwidth_percentile_20 = bandwidth_series.quantile(0.2)
    squeeze_periods = (bandwidth_series < bandwidth_percentile_20).sum()
    print(f"\nBollinger Squeeze (bottom 20% bandwidth): {squeeze_periods} periods ({squeeze_periods/len(bandwidth_series)*100:.1f}%)")
    
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
    
    # Find interesting points
    close_prices = test_data['close']
    upper_band = result['upper']
    lower_band = result['lower']
    
    # Band touches and breakouts
    band_events = []
    for i in range(1, len(close_prices)):
        # Upper band touch
        if close_prices.iloc[i] >= upper_band.iloc[i] and close_prices.iloc[i-1] < upper_band.iloc[i-1]:
            band_events.append({
                'index': i,
                'type': 'upper_touch',
                'price': float(close_prices.iloc[i]),
                'band': float(upper_band.iloc[i])
            })
        # Lower band touch
        elif close_prices.iloc[i] <= lower_band.iloc[i] and close_prices.iloc[i-1] > lower_band.iloc[i-1]:
            band_events.append({
                'index': i,
                'type': 'lower_touch',
                'price': float(close_prices.iloc[i]),
                'band': float(lower_band.iloc[i])
            })
        # Breakout above upper
        elif close_prices.iloc[i] > upper_band.iloc[i] and close_prices.iloc[i-1] <= upper_band.iloc[i-1]:
            band_events.append({
                'index': i,
                'type': 'upper_breakout',
                'price': float(close_prices.iloc[i]),
                'band': float(upper_band.iloc[i])
            })
        # Breakout below lower
        elif close_prices.iloc[i] < lower_band.iloc[i] and close_prices.iloc[i-1] >= lower_band.iloc[i-1]:
            band_events.append({
                'index': i,
                'type': 'lower_breakout',
                'price': float(close_prices.iloc[i]),
                'band': float(lower_band.iloc[i])
            })
    
    # Find squeeze periods (consecutive low bandwidth)
    squeeze_events = []
    in_squeeze = False
    squeeze_start = None
    
    for i in range(len(bandwidth_series)):
        if bandwidth_series.iloc[i] < bandwidth_percentile_20:
            if not in_squeeze:
                in_squeeze = True
                squeeze_start = i
        else:
            if in_squeeze:
                in_squeeze = False
                if i - squeeze_start >= 3:  # At least 3 periods
                    squeeze_events.append({
                        'start': squeeze_start,
                        'end': i,
                        'duration': i - squeeze_start
                    })
    
    viz_data = {
        "time": time_series,
        "open": test_data['open'].tolist() if 'open' in test_data.columns else test_data['close'].tolist(),
        "high": test_data['high'].tolist() if 'high' in test_data.columns else test_data['close'].tolist(),
        "low": test_data['low'].tolist() if 'low' in test_data.columns else test_data['close'].tolist(),
        "close": test_data['close'].tolist(),
        "indicators": {
            "bb_upper": [float(v) if not pd.isna(v) else None for v in result['upper']],
            "bb_middle": [float(v) if not pd.isna(v) else None for v in result['middle']],
            "bb_lower": [float(v) if not pd.isna(v) else None for v in result['lower']],
            "bb_bandwidth": [float(v) if not pd.isna(v) else None for v in result['bandwidth']],
            "bb_percent_b": [float(v) if not pd.isna(v) else None for v in result['percent_b']]
        },
        "signals": {
            "band_events": band_events,
            "squeeze_events": squeeze_events,
            "thresholds": {
                "overbought": 1.0,  # %B > 1
                "oversold": 0.0,    # %B < 0
                "squeeze": float(bandwidth_percentile_20)
            }
        }
    }
    
    print("\nCHART_DATA_START")
    print(json.dumps(viz_data))
    print("CHART_DATA_END")