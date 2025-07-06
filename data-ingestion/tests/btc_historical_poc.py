#!/usr/bin/env python3
"""
Bitcoin Historical Data Ingester - Proof of Concept
Demonstrates fetching historical BTC data and publishing to Pulsar
"""

import asyncio
import json
import random
import requests
from datetime import datetime, timedelta
import pulsar


class BTCHistoricalIngester:
    def __init__(self):
        self.pulsar_url = "pulsar://localhost:6650"
        
    async def fetch_btc_history_coingecko(self, days=7):
        """Fetch BTC price history - using demo data for POC"""
        print(f"Generating demo BTC history for {days} days...")
        
        # For POC, generate synthetic data based on current price
        # In production, would use proper API with authentication
        current_price = 109320  # Current BTC price from our test
        
        ohlcv_data = []
        now = datetime.utcnow()
        
        # Generate hourly data for the past 7 days
        for i in range(days * 24):
            timestamp = now - timedelta(hours=i)
            # Add some random variation (±2%)
            import random
            variation = random.uniform(-0.02, 0.02)
            price = current_price * (1 + variation)
            
            ohlcv_data.append({
                "timestamp": timestamp.isoformat() + "Z",
                "symbol": "BTCUSD", 
                "open": price - 50,
                "high": price + 100,
                "low": price - 100,
                "close": price,
                "volume": random.uniform(100, 1000)
            })
        
        # Reverse to chronological order
        ohlcv_data.reverse()
        
        print(f"   ✅ Generated {len(ohlcv_data)} hourly price points")
        return ohlcv_data
    
    async def publish_to_pulsar(self, ohlcv_data):
        """Publish historical data to Pulsar"""
        print("\nPublishing to Pulsar historical topic...")
        
        client = pulsar.Client(self.pulsar_url)
        
        # Future topic structure for historical data
        topic = "persistent://public/default/test/historical/crypto/btcusd/ohlcv"
        
        try:
            producer = client.create_producer(topic)
            print(f"   Created producer for {topic}")
            
            # Publish first 5 data points as example
            for i, data_point in enumerate(ohlcv_data[:5]):
                message = json.dumps(data_point).encode('utf-8')
                producer.send(message)
                print(f"   Published: {data_point['timestamp']} - ${data_point['close']:.2f}")
            
            print(f"   ✅ Published {min(5, len(ohlcv_data))} messages to Pulsar")
            
            producer.close()
            
        except Exception as e:
            print(f"   ❌ Error publishing to Pulsar: {e}")
        
        client.close()
    
    async def run_demo(self):
        """Run the demo ingestion"""
        print("Bitcoin Historical Data Ingester - Demo")
        print("="*50)
        
        # Fetch historical data
        ohlcv_data = await self.fetch_btc_history_coingecko(days=7)
        
        if ohlcv_data:
            # Show data range
            print(f"\nData range:")
            print(f"   From: {ohlcv_data[0]['timestamp']}")
            print(f"   To:   {ohlcv_data[-1]['timestamp']}")
            print(f"   Points: {len(ohlcv_data)}")
            
            # Publish to Pulsar
            await self.publish_to_pulsar(ohlcv_data)
            
            print("\nDemo complete!")
            print("\nNext steps for production:")
            print("1. Create proper Pulsar namespace (sptraderb/historical)")
            print("2. Configure JDBC sink to write to crypto_ohlcv table")
            print("3. Add proper OHLCV calculation from tick data")
            print("4. Handle larger datasets with batching")
        else:
            print("\nNo data fetched - check network connection")


async def main():
    ingester = BTCHistoricalIngester()
    await ingester.run_demo()


if __name__ == "__main__":
    asyncio.run(main())