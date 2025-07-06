#!/usr/bin/env python3
"""
BTC/USD Pulsar Integration Test
Tests the unified data pipeline with Bitcoin data
"""

import asyncio
import json
import sys
import time
from datetime import datetime, timedelta, timezone
import pulsar
import psycopg2
import requests


class BTCPulsarIntegrationTest:
    def __init__(self):
        self.pulsar_url = "pulsar://localhost:6650"
        self.db_url = "postgresql://postgres@localhost:5432/forex_trading"
        self.results = {
            "pulsar_connected": False,
            "realtime_data_flowing": False,
            "historical_data_ingested": False,
            "database_updated": False,
            "errors": []
        }
    
    async def test_pulsar_connection(self):
        """Test connection to Pulsar"""
        print("1. Testing Pulsar connection...")
        try:
            client = pulsar.Client(self.pulsar_url)
            self.results["pulsar_connected"] = True
            print("   ✅ Connected to Pulsar")
            return client
        except Exception as e:
            self.results["errors"].append(f"Pulsar connection failed: {e}")
            print(f"   ❌ Failed to connect to Pulsar: {e}")
            return None
    
    async def test_realtime_btc_data(self, client):
        """Test real-time BTC data from Kraken ingester"""
        print("\n2. Testing real-time BTC data flow...")
        
        topic = "persistent://public/default/market-data/crypto/raw/kraken/btcusd/ticker"
        
        try:
            consumer = client.subscribe(
                topic,
                subscription_name='btc-test-consumer',
                consumer_type=pulsar.ConsumerType.Shared,
                initial_position=pulsar.InitialPosition.Latest
            )
            
            print(f"   Subscribed to {topic}")
            print("   Waiting for messages (5 second timeout)...")
            
            # Try to receive a message
            try:
                msg = consumer.receive(timeout_millis=5000)
                data = json.loads(msg.data().decode('utf-8'))
                
                print(f"   ✅ Received BTC ticker data:")
                print(f"      Timestamp: {data.get('timestamp', 'N/A')}")
                print(f"      Symbol: {data.get('symbol', 'N/A')}")
                if 'data' in data and 'last' in data['data']:
                    price = data['data']['last'][0]
                    print(f"      Price: ${price}")
                
                self.results["realtime_data_flowing"] = True
                consumer.acknowledge(msg)
                
            except Exception as timeout_e:
                print(f"   ⚠️  No messages received in 5 seconds")
                self.results["errors"].append(f"No real-time data: {timeout_e}")
            
            consumer.close()
            
        except Exception as e:
            self.results["errors"].append(f"Real-time test failed: {e}")
            print(f"   ❌ Failed to test real-time data: {e}")
    
    async def ingest_historical_btc_data(self):
        """Ingest historical BTC data (placeholder for future implementation)"""
        print("\n3. Testing historical BTC data ingestion...")
        
        # For now, just show what would happen
        print("   ⏳ Historical BTC ingestion not yet implemented")
        print("   Plan:")
        print("      - Source: CoinGecko/CryptoCompare API")
        print("      - Topic: sptraderb/historical/crypto/btcusd/ohlcv")
        print("      - JDBC Sink: → crypto_ohlcv table")
        
        # Simulate what the flow would look like
        print("\n   Example flow (when implemented):")
        print("   1. Fetch last 7 days of BTC OHLCV data")
        print("   2. Publish to Pulsar historical topic")
        print("   3. JDBC sink writes to TimescaleDB")
        print("   4. Continuous aggregates update automatically")
        
        self.results["historical_data_ingested"] = False  # Not yet implemented
    
    async def verify_database(self):
        """Verify database setup for crypto data"""
        print("\n4. Verifying database setup...")
        
        try:
            conn = psycopg2.connect(self.db_url)
            cur = conn.cursor()
            
            # Check if crypto tables exist (they might not yet)
            cur.execute("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name LIKE 'crypto%'
            """)
            
            crypto_tables = cur.fetchall()
            
            if crypto_tables:
                print("   ✅ Found crypto tables:")
                for table in crypto_tables:
                    print(f"      - {table[0]}")
                self.results["database_updated"] = True
            else:
                print("   ℹ️  No crypto tables found yet (expected)")
                print("   Future tables will include:")
                print("      - crypto_ticks")
                print("      - crypto_ohlcv") 
                print("      - crypto_candles_1h (continuous aggregate)")
            
            cur.close()
            conn.close()
            
        except Exception as e:
            self.results["errors"].append(f"Database check failed: {e}")
            print(f"   ❌ Failed to check database: {e}")
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*60)
        print("TEST SUMMARY")
        print("="*60)
        
        print(f"✅ Pulsar Connected: {self.results['pulsar_connected']}")
        print(f"{'✅' if self.results['realtime_data_flowing'] else '❌'} Real-time Data: {self.results['realtime_data_flowing']}")
        print(f"⏳ Historical Data: Not yet implemented")
        print(f"ℹ️  Database Setup: Ready for crypto tables")
        
        if self.results["errors"]:
            print("\nErrors encountered:")
            for error in self.results["errors"]:
                print(f"  - {error}")
        
        print("\nNext Steps:")
        print("1. Implement historical BTC data ingester")
        print("2. Configure JDBC sink for historical namespace")
        print("3. Create crypto tables in TimescaleDB")
        print("4. Test complete pipeline flow")
        
        # Return exit code
        return 0 if self.results["pulsar_connected"] and self.results["realtime_data_flowing"] else 1
    
    async def run_all_tests(self):
        """Run all integration tests"""
        print("BTC/USD Pulsar Integration Test")
        print("================================\n")
        
        # Test Pulsar connection
        client = await self.test_pulsar_connection()
        if not client:
            return self.print_summary()
        
        # Test real-time data
        await self.test_realtime_btc_data(client)
        
        # Test historical ingestion (placeholder)
        await self.ingest_historical_btc_data()
        
        # Verify database
        await self.verify_database()
        
        # Close Pulsar client
        client.close()
        
        # Print summary
        return self.print_summary()


async def main():
    test = BTCPulsarIntegrationTest()
    exit_code = await test.run_all_tests()
    sys.exit(exit_code)


if __name__ == "__main__":
    asyncio.run(main())