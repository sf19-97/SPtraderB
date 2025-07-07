#!/usr/bin/env python3
"""
Test script to check if Dukascopy provides Bitcoin (BTCUSD) historical data
"""

import requests
import lzma
import struct
from datetime import datetime, timedelta, timezone
import time

class DukascopyBitcoinTester:
    def __init__(self):
        self.base_url = "https://datafeed.dukascopy.com/datafeed"
        
    def check_hour_availability(self, symbol, date, hour):
        """Check if data is available for a specific hour"""
        url = f"{self.base_url}/{symbol.upper()}/{date.year}/{date.month-1:02d}/{date.day:02d}/{hour:02d}h_ticks.bi5"
        
        try:
            response = requests.head(url, timeout=10)  # HEAD request to check without downloading
            return response.status_code == 200, url
        except Exception as e:
            return False, url
    
    def download_and_parse_sample(self, symbol, date, hour):
        """Download and parse a sample hour of data"""
        url = f"{self.base_url}/{symbol.upper()}/{date.year}/{date.month-1:02d}/{date.day:02d}/{hour:02d}h_ticks.bi5"
        
        try:
            response = requests.get(url, timeout=30)
            if response.status_code != 200:
                return None, f"HTTP {response.status_code}"
            
            # Parse the data
            compressed_data = response.content
            decompressed = lzma.decompress(compressed_data)
            
            # Parse first few ticks
            chunk_size = struct.calcsize('>3I2f')
            ticks = []
            
            for i in range(0, min(len(decompressed), chunk_size * 5), chunk_size):  # First 5 ticks
                if i + chunk_size > len(decompressed):
                    break
                    
                chunk = decompressed[i:i + chunk_size]
                timestamp_ms, ask_raw, bid_raw, ask_vol, bid_vol = struct.unpack('>3I2f', chunk)
                
                # For crypto, typically uses 2 decimal places (but let's check both)
                # Try standard forex 5 decimal places first
                ask_price_5dp = ask_raw / 100000.0
                bid_price_5dp = bid_raw / 100000.0
                
                # Also try 2 decimal places (common for Bitcoin)
                ask_price_2dp = ask_raw / 100.0
                bid_price_2dp = bid_raw / 100.0
                
                ticks.append({
                    'timestamp_ms': timestamp_ms,
                    'ask_raw': ask_raw,
                    'bid_raw': bid_raw,
                    'ask_5dp': ask_price_5dp,
                    'bid_5dp': bid_price_5dp,
                    'ask_2dp': ask_price_2dp,
                    'bid_2dp': bid_price_2dp,
                    'ask_vol': ask_vol,
                    'bid_vol': bid_vol
                })
            
            return ticks, f"Found {len(decompressed) // chunk_size} ticks"
            
        except Exception as e:
            return None, str(e)
    
    def test_crypto_symbols(self):
        """Test various cryptocurrency symbols"""
        crypto_symbols = [
            "BTCUSD",    # Bitcoin vs USD
            "ETHUSD",    # Ethereum vs USD
            "LTCUSD",    # Litecoin vs USD
            "XRPUSD",    # Ripple vs USD
            "BCHUSD",    # Bitcoin Cash vs USD
            "BTCEUR",    # Bitcoin vs EUR
            "ETHEUR",    # Ethereum vs EUR
            "BTCJPY",    # Bitcoin vs JPY
        ]
        
        print("Testing Dukascopy Cryptocurrency Data Availability")
        print("=" * 80)
        print(f"Base URL: {self.base_url}")
        print(f"Testing date: 2024-01-01 12:00 UTC")
        print("-" * 80)
        
        test_date = datetime(2024, 1, 1, 12, 0, 0)
        
        for symbol in crypto_symbols:
            available, url = self.check_hour_availability(symbol, test_date, 12)
            print(f"\n{symbol}: {'✓ AVAILABLE' if available else '✗ NOT AVAILABLE'}")
            print(f"URL: {url}")
            
            if available:
                # Try to download and parse sample data
                print("Downloading sample data...")
                ticks, info = self.download_and_parse_sample(symbol, test_date, 12)
                
                if ticks:
                    print(f"Success: {info}")
                    print("Sample tick data:")
                    for i, tick in enumerate(ticks[:3]):  # Show first 3 ticks
                        print(f"  Tick {i+1}:")
                        print(f"    Raw values: ask={tick['ask_raw']}, bid={tick['bid_raw']}")
                        print(f"    5 decimal places: ask={tick['ask_5dp']:.5f}, bid={tick['bid_5dp']:.5f}")
                        print(f"    2 decimal places: ask={tick['ask_2dp']:.2f}, bid={tick['bid_2dp']:.2f}")
                        
                        # Determine which decimal format makes sense
                        if tick['ask_2dp'] > 10000 and tick['ask_2dp'] < 200000:  # Reasonable Bitcoin price range
                            print(f"    → Likely using 2 decimal places (Bitcoin price ~${tick['ask_2dp']:.2f})")
                        elif tick['ask_5dp'] > 10000 and tick['ask_5dp'] < 200000:
                            print(f"    → Likely using 5 decimal places (Bitcoin price ~${tick['ask_5dp']:.5f})")
                else:
                    print(f"Failed to parse data: {info}")
            
            time.sleep(0.5)  # Be nice to the server
        
        # Also test recent data availability
        print("\n" + "=" * 80)
        print("Testing Recent Data Availability for BTCUSD")
        print("-" * 80)
        
        now = datetime.now(timezone.utc)
        
        # Check last 48 hours
        for hours_back in range(0, 48, 6):
            test_time = now - timedelta(hours=hours_back)
            test_time = test_time.replace(minute=0, second=0, microsecond=0)
            available, url = self.check_hour_availability("BTCUSD", test_time, test_time.hour)
            
            print(f"{test_time.strftime('%Y-%m-%d %H:00')} UTC - {'✓ Available' if available else '✗ Not available'}")
            
            if available and hours_back == 0:
                print("→ Real-time data available!")
            elif available:
                print(f"→ Data delay: {hours_back} hours")
                break
            
            time.sleep(0.2)

def main():
    tester = DukascopyBitcoinTester()
    tester.test_crypto_symbols()

if __name__ == "__main__":
    main()