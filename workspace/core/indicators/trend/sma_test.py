"""
Simple Moving Average Indicator for Testing Data Export
"""
import pandas as pd
from typing import Dict, Any
from core.base.indicator import Indicator

__metadata_version__ = 1
__metadata__ = {
    'name': 'sma_test',
    'category': 'trend',
    'version': '1.0.0',
    'description': 'Simple Moving Average for testing data export functionality',
    'author': 'system',
    'status': 'in_progress',
    'inputs': ['close'],
    'outputs': ['sma'],
    'parameters': {
        'period': {
            'type': 'int',
            'default': 20,
            'min': 2,
            'max': 200,
            'description': 'SMA calculation period'
        }
    },
    'tags': ['trend', 'moving_average', 'test']
}

class SMATest(Indicator):
    """
    Simple Moving Average indicator for testing the data export/import pipeline.
    Calculates the average of closing prices over a specified period.
    """
    
    def __init__(self, period: int = 20):
        super().__init__()
        self.period = period
        
    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate SMA values
        
        Args:
            data: DataFrame with OHLC columns
            
        Returns:
            DataFrame with SMA values
        """
        # Ensure we have the required column
        if 'close' not in data.columns:
            raise ValueError("Data must contain 'close' column")
        
        # Calculate Simple Moving Average
        sma = data['close'].rolling(window=self.period, min_periods=1).mean()
        
        # Return as DataFrame
        return pd.DataFrame({
            'sma': sma
        }, index=data.index)
    
    @property
    def metadata(self) -> Dict[str, Any]:
        return __metadata__

# Test the indicator when run directly
if __name__ == "__main__":
    import sys
    import os
    import time
    
    start_time = time.time()
    
    sys.path.append('/Users/sebastian/Projects/SPtraderB/workspace')
    
    from core.data.loader import load_data_from_env
    
    print("Testing SMA Indicator...")
    print("-" * 50)
    
    # Load data using the unified interface that checks DATA_SOURCE env var
    data = load_data_from_env()
    
    print(f"Loaded {len(data)} rows of test data")
    print(f"Columns: {list(data.columns)}")
    print(f"Date range: {data.index[0]} to {data.index[-1]}")
    
    # Create indicator
    sma = SMATest(period=20)
    
    # Calculate
    result = sma.calculate(data)
    
    # Display results
    print(f"\nSMA Results:")
    print(f"Shape: {result.shape}")
    print(f"\nFirst 5 values:")
    print(result.head())
    print(f"\nLast 5 values:")
    print(result.tail())
    
    # Show some statistics
    print(f"\nStatistics:")
    print(f"Mean SMA: {result['sma'].mean():.4f}")
    print(f"Std Dev: {result['sma'].std():.4f}")
    print(f"Min: {result['sma'].min():.4f}")
    print(f"Max: {result['sma'].max():.4f}")
    
    # Output data for chart overlay (JSON format for easy parsing)
    import json
    indicator_output = {
        'name': 'SMA',
        'values': result['sma'].dropna().tolist()  # Remove NaN values
    }
    print(f"\nINDICATOR_DATA:{json.dumps(indicator_output)}")
    
    # Output chart data for visualization
    if 'time' in data.columns:
        time_data = data['time'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist()
    else:
        time_data = data.index.strftime('%Y-%m-%d %H:%M:%S').tolist()
    
    chart_data = {
        "time": time_data,
        "open": data['open'].tolist(),
        "high": data['high'].tolist(),
        "low": data['low'].tolist(),
        "close": data['close'].tolist(),
        "indicators": {
            "sma": result['sma'].tolist()
        }
    }
    
    print("\nCHART_DATA_START")
    print(json.dumps(chart_data))
    print("CHART_DATA_END")
    
    # Output execution time
    import time
    end_time = time.time()
    if 'start_time' in locals():
        print(f"\nExecution completed in {(end_time - start_time) * 1000:.2f} ms")
    else:
        print(f"\nExecution completed")