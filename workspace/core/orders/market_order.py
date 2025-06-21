"""
Market Order - Simple market order execution
"""
import pandas as pd
from typing import Dict, Any, Optional
from core.base.order import Order

__metadata_version__ = 1
__metadata__ = {
    'name': 'market_order',
    'category': 'market',
    'version': '1.0.0',
    'description': 'Simple market order with optional size limits',
    'author': 'system',
    'status': 'ready',
    'order_types': ['market'],
    'parameters': {
        'base_size': {
            'type': 'float',
            'default': 0.01,
            'min': 0.001,
            'max': 1.0,
            'description': 'Base position size as fraction of capital'
        },
        'max_slippage': {
            'type': 'float',
            'default': 0.001,
            'min': 0.0,
            'max': 0.01,
            'description': 'Maximum acceptable slippage'
        },
        'urgency': {
            'type': 'str',
            'default': 'normal',
            'options': ['passive', 'normal', 'aggressive'],
            'description': 'Order urgency affects execution style'
        }
    },
    'tags': ['simple', 'market', 'immediate']
}

class MarketOrder(Order):
    """
    Simple market order executor with configurable size and urgency.
    
    Urgency levels:
    - passive: Use best bid/ask, may not fill immediately
    - normal: Standard market order
    - aggressive: Accept worse price for immediate fill
    """
    
    def __init__(self, base_size: float = 0.01, max_slippage: float = 0.001, 
                 urgency: str = 'normal', **params):
        self.base_size = base_size
        self.max_slippage = max_slippage
        self.urgency = urgency
        self.params = params
    
    def execute(self, market_state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute market order
        
        Args:
            market_state: Dictionary containing:
                - symbol: Trading symbol
                - side: 'buy' or 'sell'
                - bid: Current bid price
                - ask: Current ask price
                - spread: Bid-ask spread
                - capital: Available capital
                - timestamp: Current time
            
        Returns:
            Order details dictionary
        """
        symbol = market_state.get('symbol', 'UNKNOWN')
        side = market_state.get('side', 'buy')
        bid = market_state.get('bid', 0.0)
        ask = market_state.get('ask', 0.0)
        spread = market_state.get('spread', ask - bid)
        capital = market_state.get('capital', 10000.0)
        timestamp = market_state.get('timestamp', pd.Timestamp.now())
        
        # Calculate order size
        position_value = capital * self.base_size
        
        # Determine execution price based on urgency
        if side == 'buy':
            if self.urgency == 'passive':
                price = bid  # Try to buy at bid
            elif self.urgency == 'aggressive':
                price = ask + (spread * 0.1)  # Pay slightly above ask
            else:
                price = ask  # Normal market buy at ask
        else:
            if self.urgency == 'passive':
                price = ask  # Try to sell at ask
            elif self.urgency == 'aggressive':
                price = bid - (spread * 0.1)  # Sell slightly below bid
            else:
                price = bid  # Normal market sell at bid
        
        # Calculate final size
        size = position_value / price if price > 0 else 0
        
        # Build order
        order = {
            'type': 'market',
            'symbol': symbol,
            'side': side,
            'size': size,
            'price': price,
            'value': position_value,
            'urgency': self.urgency,
            'max_slippage': self.max_slippage,
            'timestamp': timestamp,
            'time_in_force': 'IOC' if self.urgency == 'aggressive' else 'GTC',
            'metadata': {
                'base_size': self.base_size,
                'spread_at_order': spread,
                'capital_used': position_value
            }
        }
        
        return order
    
    @property
    def metadata(self) -> Dict[str, Any]:
        return __metadata__

# Test the order
if __name__ == "__main__":
    # Test market state
    market_state = {
        'symbol': 'EURUSD',
        'side': 'buy',
        'bid': 1.0850,
        'ask': 1.0852,
        'spread': 0.0002,
        'capital': 10000.0,
        'timestamp': pd.Timestamp.now()
    }
    
    # Test different urgency levels
    for urgency in ['passive', 'normal', 'aggressive']:
        order_executor = MarketOrder(base_size=0.02, urgency=urgency)
        order = order_executor.execute(market_state)
        
        print(f"\n{urgency.upper()} Order:")
        print(f"  Price: {order['price']:.5f}")
        print(f"  Size: {order['size']:.2f}")
        print(f"  Value: ${order['value']:.2f}")