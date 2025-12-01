"""
Average Directional Index (ADX) Indicator
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
    'name': 'adx',
    'category': 'momentum',
    'version': '1.0.0',
    'description': 'Average Directional Index - measures trend strength regardless of direction',
    'author': 'system',
    'inputs': ['high', 'low', 'close'],
    'outputs': ['adx', 'plus_di', 'minus_di'],
    'lookback_required': 50,  # Need ~3x period for proper Wilder's smoothing warmup
    'parameters': {
        'period': {
            'type': 'int',
            'default': 14,
            'min': 7,
            'max': 50,
            'description': 'Number of periods for ADX calculation'
        }
    },
    'performance_budget': {
        'max_ms': 2.0,  # Slightly higher than SMA due to complexity
        'complexity': 'O(n)'
    },
    'min_lookback': 30,
    'tags': ['momentum', 'trend_strength', 'volatility', 'directional_movement']
}

class ADX(Indicator):
    """
    Average Directional Index (ADX) - A momentum indicator that measures
    the strength of a trend, regardless of its direction.
    
    The ADX is derived from the Directional Movement System developed by
    J. Welles Wilder. It uses the Plus Directional Indicator (+DI) and 
    Minus Directional Indicator (-DI) to determine trend strength.
    
    ADX values:
    - 0-25: Weak or no trend
    - 25-50: Strong trend
    - 50-75: Very strong trend
    - 75-100: Extremely strong trend
    
    Common uses:
    - Trend strength identification
    - Filter for trend-following strategies
    - Identify ranging vs trending markets
    """
    
    def __init__(self, period: int = 14):
        super().__init__()
        self.period = period
        
    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate ADX values using Wilder's smoothing method
        
        Args:
            data: DataFrame with high, low, close columns
            
        Returns:
            DataFrame with 'adx', 'plus_di', 'minus_di' columns
        """
        # Ensure we have required columns
        if not all(col in data.columns for col in ['high', 'low', 'close']):
            raise ValueError("Data must contain 'high', 'low', and 'close' columns")
        
        high = data['high']
        low = data['low']
        close = data['close']
        
        # Calculate True Range (TR)
        prev_close = close.shift(1)
        tr1 = high - low
        tr2 = abs(high - prev_close)
        tr3 = abs(low - prev_close)
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        
        # Calculate Directional Movement
        high_diff = high - high.shift(1)
        low_diff = low.shift(1) - low
        
        # Plus DM: when high_diff > low_diff and high_diff > 0
        plus_dm = pd.Series(0.0, index=data.index)
        plus_dm[(high_diff > low_diff) & (high_diff > 0)] = high_diff[(high_diff > low_diff) & (high_diff > 0)]
        
        # Minus DM: when low_diff > high_diff and low_diff > 0
        minus_dm = pd.Series(0.0, index=data.index)
        minus_dm[(low_diff > high_diff) & (low_diff > 0)] = low_diff[(low_diff > high_diff) & (low_diff > 0)]
        
        # Apply Wilder's smoothing (special EMA with alpha = 1/period)
        # First value is SMA, then apply Wilder's smoothing
        atr = self._wilders_smoothing(tr, self.period)
        plus_dm_smooth = self._wilders_smoothing(plus_dm, self.period)
        minus_dm_smooth = self._wilders_smoothing(minus_dm, self.period)
        
        # Calculate Directional Indicators
        plus_di = 100 * plus_dm_smooth / atr
        minus_di = 100 * minus_dm_smooth / atr
        
        # Handle division by zero
        plus_di = plus_di.fillna(0)
        minus_di = minus_di.fillna(0)
        
        # Calculate DX
        di_sum = plus_di + minus_di
        di_diff = abs(plus_di - minus_di)
        dx = pd.Series(0.0, index=data.index)
        dx[di_sum != 0] = 100 * di_diff[di_sum != 0] / di_sum[di_sum != 0]
        
        # Calculate ADX using Wilder's smoothing on DX
        adx = self._wilders_smoothing(dx, self.period)
        
        return pd.DataFrame({
            'adx': adx,
            'plus_di': plus_di,
            'minus_di': minus_di
        })
    
    def _wilders_smoothing(self, series: pd.Series, period: int) -> pd.Series:
        """
        Apply Wilder's smoothing (special EMA where alpha = 1/period)
        
        Args:
            series: Input series to smooth
            period: Smoothing period
            
        Returns:
            Smoothed series
        """
        # First value is SMA
        sma = series.rolling(window=period, min_periods=1).mean()
        
        # Apply Wilder's smoothing
        smoothed = pd.Series(index=series.index, dtype=float)
        smoothed.iloc[:period] = sma.iloc[:period]
        
        # Wilder's smoothing: Current = (Previous * (period - 1) + Current Value) / period
        for i in range(period, len(series)):
            if pd.notna(smoothed.iloc[i-1]) and pd.notna(series.iloc[i]):
                smoothed.iloc[i] = (smoothed.iloc[i-1] * (period - 1) + series.iloc[i]) / period
            else:
                smoothed.iloc[i] = np.nan
                
        return smoothed
    
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
    
    # Check if we have required OHLC data
    if not all(col in test_data.columns for col in ['high', 'low', 'close']):
        print("ERROR: ADX requires high, low, and close price data")
        print(f"Available columns: {test_data.columns.tolist()}")
        sys.exit(1)
    
    # Calculate ADX
    indicator = ADX(period=14)
    result = indicator.calculate(test_data)
    
    # Display results
    print(f"\nFirst 5 ADX values:")
    print(result.head())
    
    print(f"\nLast 5 ADX values:")
    print(result.tail())
    
    print(f"\nADX Statistics:")
    print(f"Mean: {result['adx'].mean():.2f}")
    print(f"Std Dev: {result['adx'].std():.2f}")
    print(f"Min: {result['adx'].min():.2f}")
    print(f"Max: {result['adx'].max():.2f}")
    
    # Trend strength analysis
    adx_values = result['adx'].dropna()
    weak_trend = (adx_values < 25).sum()
    strong_trend = ((adx_values >= 25) & (adx_values < 50)).sum()
    very_strong = ((adx_values >= 50) & (adx_values < 75)).sum()
    extremely_strong = (adx_values >= 75).sum()
    
    print(f"\nTrend Strength Distribution:")
    print(f"Weak/No trend (0-25): {weak_trend} periods ({weak_trend/len(adx_values)*100:.1f}%)")
    print(f"Strong trend (25-50): {strong_trend} periods ({strong_trend/len(adx_values)*100:.1f}%)")
    print(f"Very strong (50-75): {very_strong} periods ({very_strong/len(adx_values)*100:.1f}%)")
    print(f"Extremely strong (75+): {extremely_strong} periods ({extremely_strong/len(adx_values)*100:.1f}%)")
    
    # Performance test
    import time
    start = time.perf_counter()
    for _ in range(100):  # Fewer iterations due to complexity
        indicator.calculate(test_data)
    elapsed = (time.perf_counter() - start) / 100 * 1000  # ms per calculation
    
    print(f"\nPerformance: {elapsed:.3f}ms per calculation")
    print(f"✓ Meets performance budget: {elapsed < __metadata__['performance_budget']['max_ms']}")
    
    # Output visualization data
    import json
    
    # Prepare data for visualization
    if 'date' in test_data.columns:
        time_series = test_data['date'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist()
    else:
        time_series = test_data.index.strftime('%Y-%m-%d %H:%M:%S').tolist()
    
    # Find interesting points (trend changes)
    adx_series = result['adx'].fillna(0)
    trend_changes = []
    for i in range(1, len(adx_series)):
        # Mark when ADX crosses 25 threshold (weak to strong trend)
        if adx_series.iloc[i-1] < 25 and adx_series.iloc[i] >= 25:
            trend_changes.append({
                'index': i,
                'type': 'trend_start',
                'value': float(adx_series.iloc[i])
            })
        elif adx_series.iloc[i-1] >= 25 and adx_series.iloc[i] < 25:
            trend_changes.append({
                'index': i,
                'type': 'trend_end',
                'value': float(adx_series.iloc[i])
            })
    
    viz_data = {
        "time": time_series,
        "open": test_data['open'].tolist() if 'open' in test_data.columns else test_data['close'].tolist(),
        "high": test_data['high'].tolist(),
        "low": test_data['low'].tolist(),
        "close": test_data['close'].tolist(),
        "indicators": {
            "adx": [float(v) if not pd.isna(v) else None for v in result['adx']],
            "plus_di": [float(v) if not pd.isna(v) else None for v in result['plus_di']],
            "minus_di": [float(v) if not pd.isna(v) else None for v in result['minus_di']]
        },
        "signals": {
            "trend_changes": trend_changes,
            "adx_levels": {
                "weak": 25,
                "strong": 50,
                "very_strong": 75
            }
        }
    }
    
    print("\nCHART_DATA_START")
    print(json.dumps(viz_data))
    print("CHART_DATA_END")