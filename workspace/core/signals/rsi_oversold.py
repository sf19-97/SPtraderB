"""
RSI Oversold Signal - Triggers when RSI drops below threshold
"""
import pandas as pd
from typing import List, Dict, Any
from core.base.signal import Signal

__metadata_version__ = 1
__metadata__ = {
    'name': 'rsi_oversold',
    'description': 'Detects oversold conditions with RSI threshold',
    'category': 'mean_reversion',
    'version': '1.0.0',
    'author': 'system',
    'status': 'ready',
    'required_indicators': ['rsi'],
    'outputs': ['boolean', 'signal_strength'],
    'parameters': {
        'oversold_threshold': {
            'type': 'float',
            'default': 30.0,
            'min': 0.0,
            'max': 50.0,
            'description': 'RSI level below which market is considered oversold'
        },
        'min_bars': {
            'type': 'int',
            'default': 2,
            'min': 1,
            'max': 10,
            'description': 'Minimum bars RSI must stay oversold'
        }
    },
    'tags': ['momentum', 'oversold', 'reversal', 'entry']
}

class RSIOversold(Signal):
    """
    Generates buy signals when RSI drops below oversold threshold.
    Can require RSI to stay oversold for multiple bars to avoid false signals.
    """
    
    def __init__(self, oversold_threshold: float = 30.0, min_bars: int = 2):
        self.oversold_threshold = oversold_threshold
        self.min_bars = min_bars
    
    @property
    def required_indicators(self) -> List[str]:
        """List of required indicators"""
        return __metadata__['required_indicators']
    
    def evaluate(self, data: pd.DataFrame, indicators: Dict[str, pd.Series]) -> pd.Series:
        """
        Evaluate signal conditions
        
        Args:
            data: OHLC DataFrame
            indicators: Dictionary with 'rsi' series
            
        Returns:
            Boolean series indicating signal triggers
        """
        if 'rsi' not in indicators:
            raise ValueError("RSI indicator not provided")
        
        rsi = indicators['rsi']
        
        # Check if RSI is below threshold
        oversold = rsi < self.oversold_threshold
        
        if self.min_bars > 1:
            # Require RSI to be oversold for min_bars consecutive bars
            # Signal triggers when exiting oversold after being there for min_bars
            oversold_streak = oversold.rolling(self.min_bars).sum() == self.min_bars
            signal = oversold_streak & ~oversold.shift(-1).fillna(False)
        else:
            # Simple threshold crossing
            signal = oversold & ~oversold.shift(1).fillna(True)
        
        return signal
    
    @property
    def metadata(self) -> Dict[str, Any]:
        return __metadata__

# Test the signal
if __name__ == "__main__":
    import numpy as np
    
    # Create test data
    dates = pd.date_range('2024-01-01', periods=100, freq='D')
    test_data = pd.DataFrame({
        'date': dates,
        'close': 100 + np.random.randn(100).cumsum()
    })
    
    # Create fake RSI that goes oversold
    rsi_values = 50 + 20 * np.sin(np.linspace(0, 4*np.pi, 100))
    rsi_values[40:43] = 25  # Force oversold period
    
    indicators = {'rsi': pd.Series(rsi_values, index=test_data.index)}
    
    # Test signal
    signal = RSIOversold(oversold_threshold=30.0, min_bars=2)
    triggers = signal.evaluate(test_data, indicators)
    
    print(f"Signal triggered on {triggers.sum()} days")
    print(f"Trigger dates: {test_data.loc[triggers, 'date'].tolist()}")