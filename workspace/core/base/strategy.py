"""
Base class for all strategies
"""
from abc import ABC, abstractmethod
from typing import Dict, Any
import pandas as pd


class Strategy(ABC):
    """Base strategy interface"""
    
    @abstractmethod
    def run(self, data: pd.DataFrame) -> Dict[str, Any]:
        """Run strategy on data"""
        pass
    
    @property
    @abstractmethod
    def config(self) -> Dict[str, Any]:
        """Strategy configuration"""
        pass
