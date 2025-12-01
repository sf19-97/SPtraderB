"""
Base class for all order types
"""
from abc import ABC, abstractmethod
from typing import Dict, Any


class Order(ABC):
    """Base order interface"""
    
    @abstractmethod
    def execute(self, market_state: Dict[str, Any]) -> Dict[str, Any]:
        """Execute order based on market conditions"""
        pass
