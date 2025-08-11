#!/usr/bin/env python3
"""Test script for Live mode functionality in BuildHub IDE"""

import os
import sys
import json
import time

def test_live_mode():
    """Test that Live mode environment variables are properly passed"""
    
    print(f"[{time.strftime('%H:%M:%S')}] Testing Live mode functionality...")
    print("-" * 60)
    
    # Check for Live mode environment variables
    data_source = os.environ.get('DATA_SOURCE', 'not set')
    live_symbol = os.environ.get('LIVE_SYMBOL', 'not set')
    live_timeframe = os.environ.get('LIVE_TIMEFRAME', 'not set')
    live_from = os.environ.get('LIVE_FROM', 'not set')
    live_to = os.environ.get('LIVE_TO', 'not set')
    cache_key = os.environ.get('CACHE_KEY', 'not set')
    
    print(f"DATA_SOURCE: {data_source}")
    print(f"LIVE_SYMBOL: {live_symbol}")
    print(f"LIVE_TIMEFRAME: {live_timeframe}")
    print(f"LIVE_FROM: {live_from}")
    print(f"LIVE_TO: {live_to}")
    print(f"CACHE_KEY: {cache_key}")
    print("-" * 60)
    
    if data_source == 'live':
        print("✅ Live mode is active!")
        
        # Convert timestamps to readable dates
        try:
            from_date = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(int(live_from)))
            to_date = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(int(live_to)))
            print(f"Date range: {from_date} to {to_date}")
        except:
            print("❌ Failed to parse timestamps")
        
        # Generate sample chart data to test visualization
        print("\nGenerating sample chart data...")
        sample_data = {
            "time": [f"2025-01-20T{i:02d}:00:00Z" for i in range(10)],
            "open": [1.0850 + i * 0.0001 for i in range(10)],
            "high": [1.0852 + i * 0.0001 for i in range(10)],
            "low": [1.0848 + i * 0.0001 for i in range(10)],
            "close": [1.0851 + i * 0.0001 for i in range(10)],
            "indicators": {
                "test_line": [1.0850 + i * 0.0001 for i in range(10)]
            }
        }
        
        print("CHART_DATA_START")
        print(json.dumps(sample_data))
        print("CHART_DATA_END")
        
        print("\n✅ Live mode test completed successfully!")
    else:
        print(f"ℹ️ Data source is '{data_source}', not 'live'")
        print("Switch to Live mode in the IDE to test live functionality")

if __name__ == "__main__":
    test_live_mode()