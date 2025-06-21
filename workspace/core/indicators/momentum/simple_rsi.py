"""
Simple RSI Indicator
"""
import pandas as pd
from core.base.indicator import Indicator

__metadata_version__ = 1
__metadata__ = {
    'name': 'simple_rsi',
    'category': 'momentum',
    'version': '1.0.0',
    'description': 'Relative Strength Index - measures overbought/oversold conditions',
    'author': 'system',
    'status': 'ready',
    'inputs': ['close'],
    'outputs': ['rsi'],
    'parameters': {
        'period': {
            'type': 'int',
            'default': 14,
            'min': 2,
            'max': 100,
            'description': 'RSI calculation period'
        }
    },
    'tags': ['momentum', 'oscillator', 'overbought', 'oversold']
}

class SimpleRSI(Indicator):
    """
    Relative Strength Index (RSI) - momentum oscillator that measures
    the speed and magnitude of price changes.
    
    RSI values:
    - Above 70: Potentially overbought
    - Below 30: Potentially oversold
    """
    
    def __init__(self, period: int = 14):
        super().__init__()
        self.period = period
        
    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate RSI values
        
        Args:
            data: DataFrame with at least a 'close' column
            
        Returns:
            DataFrame with 'rsi' column
        """
        close = data['close']
        
        # Calculate price changes
        delta = close.diff()
        
        # Separate gains and losses
        gains = delta.copy()
        losses = delta.copy()
        gains[gains < 0] = 0
        losses[losses > 0] = 0
        losses = abs(losses)
        
        # Calculate average gains and losses
        avg_gains = gains.rolling(window=self.period).mean()
        avg_losses = losses.rolling(window=self.period).mean()
        
        # Calculate RS and RSI
        rs = avg_gains / avg_losses
        rsi = 100 - (100 / (1 + rs))
        
        return pd.DataFrame({'rsi': rsi})
    
    @property
    def metadata(self):
        return __metadata__