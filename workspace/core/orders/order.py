"""
Order Execution: Base Class
Created: 2025-06-22

Executes an immediate-fill market order in the direction supplied
(by YAML parameters or the calling Signal).  
• Fills at best available price + configured slippage.  
• Position size = account_equity × risk_fraction.  
• Returns an OrderIntent for the Rust execution bridge.
"""

# core/base/order.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, Any

@dataclass
class OrderIntent:
    side: str                 # 'buy' | 'sell'
    size: float               # signed or absolute –- your choice
    type: str                 # 'market' | 'limit' | 'stop', etc.
    params: Dict[str, Any]    # extra fields → e.g. slippage, tif

class Order(ABC):
    @abstractmethod
    def execute(self,
                market_state: Dict[str, Any],
                signal_context: Dict[str, Any]) -> OrderIntent | None:
        """
        Return an OrderIntent or None (if rule blocks execution).
        """
