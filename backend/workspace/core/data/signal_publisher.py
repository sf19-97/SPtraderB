"""
Redis signal publisher for live trading
Allows components to publish signals to the orchestrator via Redis streams
"""
import redis
import json
import datetime
from typing import Dict, Any, Optional
import os


class SignalPublisher:
    """Publishes trading signals to Redis for live orchestrator consumption"""
    
    def __init__(self, redis_url: str = None):
        """
        Initialize the signal publisher
        
        Args:
            redis_url: Redis connection URL (default: redis://localhost:6379)
        """
        self.redis_url = redis_url or os.environ.get('REDIS_URL', 'redis://localhost:6379')
        self.client = None
        self._connect()
    
    def _connect(self):
        """Connect to Redis"""
        try:
            # Parse URL to get connection parameters
            if self.redis_url.startswith('redis://'):
                url_parts = self.redis_url[8:].split(':')
                host = url_parts[0]
                port = int(url_parts[1]) if len(url_parts) > 1 else 6379
            else:
                host = 'localhost'
                port = 6379
                
            self.client = redis.StrictRedis(
                host=host,
                port=port,
                decode_responses=True
            )
            # Test connection
            self.client.ping()
            print(f"Connected to Redis at {host}:{port}")
        except Exception as e:
            print(f"Failed to connect to Redis: {e}")
            self.client = None
    
    def publish_signal(
        self,
        signal_name: str,
        signal_type: str,
        strength: float,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Publish a trading signal to Redis
        
        Args:
            signal_name: Name of the signal (e.g., "ma_crossover")
            signal_type: Type of signal (e.g., "golden_cross", "death_cross")
            strength: Signal strength (0.0 to 1.0)
            metadata: Additional metadata (e.g., current_price, indicators)
            
        Returns:
            True if published successfully, False otherwise
        """
        if not self.client:
            print("Not connected to Redis")
            return False
            
        try:
            # Create signal event
            signal_event = {
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                "signal_name": signal_name,
                "signal_type": signal_type,
                "strength": strength,
                "metadata": metadata or {}
            }
            
            # Publish to Redis stream
            stream_id = self.client.xadd(
                "signals:live",
                {"signal": json.dumps(signal_event)}
            )
            
            print(f"Published signal {signal_name} ({signal_type}) with ID: {stream_id}")
            return True
            
        except Exception as e:
            print(f"Failed to publish signal: {e}")
            return False
    
    def publish_price_update(self, prices: Dict[str, float]) -> bool:
        """
        Publish price updates for portfolio valuation
        
        Args:
            prices: Dictionary of symbol -> price
            
        Returns:
            True if published successfully, False otherwise
        """
        if not self.client:
            print("Not connected to Redis")
            return False
            
        try:
            # Publish to Redis stream
            stream_id = self.client.xadd(
                "signals:live",
                {"price_update": json.dumps(prices)}
            )
            
            print(f"Published price update with ID: {stream_id}")
            return True
            
        except Exception as e:
            print(f"Failed to publish price update: {e}")
            return False
    
    def close(self):
        """Close Redis connection"""
        if self.client:
            self.client.close()
            self.client = None


# Example usage for live signals
if __name__ == "__main__":
    # Initialize publisher
    publisher = SignalPublisher()
    
    # Example: Publish a golden cross signal
    publisher.publish_signal(
        signal_name="ma_crossover",
        signal_type="golden_cross",
        strength=0.8,
        metadata={
            "current_price": 1.0860,
            "ma_fast": 1.0858,
            "ma_slow": 1.0855,
            "volume": 1500
        }
    )
    
    # Example: Publish price update
    publisher.publish_price_update({
        "EURUSD": 1.0860,
        "USDJPY": 148.50
    })
    
    # Close connection
    publisher.close()