"""
Base class for all signals
"""
from abc import ABC, abstractmethod
from typing import List, Dict
import pandas as pd


class Signal(ABC):
    """Base signal interface"""
    
    @property
    @abstractmethod
    def required_indicators(self) -> List[str]:
        """List of required indicators"""
        pass
    
    @abstractmethod
    def evaluate(self, data: pd.DataFrame, indicators: Dict[str, pd.Series]) -> pd.Series:
        """Evaluate signal conditions"""
        pass
