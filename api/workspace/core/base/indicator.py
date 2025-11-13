"""
Base class for all indicators
"""
from abc import ABC, abstractmethod
from typing import Dict, Any
import pandas as pd


class Indicator(ABC):
    """Base indicator interface"""
    
    @abstractmethod
    def calculate(self, data: pd.Series) -> pd.Series:
        """Calculate indicator values"""
        pass
    
    @property
    @abstractmethod
    def metadata(self) -> Dict[str, Any]:
        """Return indicator metadata"""
        pass
