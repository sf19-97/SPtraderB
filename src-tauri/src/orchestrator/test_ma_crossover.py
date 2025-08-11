#!/usr/bin/env python3
"""
Test MA crossover signal via component server
"""

import json
import subprocess
import sys
import time

def test_ma_crossover():
    # Start the component server
    server_process = subprocess.Popen(
        [sys.executable, "component_server.py"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**subprocess.os.environ, 'SYMBOL': 'EURUSD'}
    )
    
    # Give it a moment to start
    time.sleep(0.5)
    
    try:
        # Generate test candles with a crossover
        candles = []
        for i in range(100):
            # Create a pattern where fast MA crosses above slow MA around candle 60
            if i < 50:
                base_price = 1.08 - (50 - i) * 0.0002  # Downtrend
            elif i < 60:
                base_price = 1.07 + (i - 50) * 0.0005  # Sharp upturn
            else:
                base_price = 1.075 + (i - 60) * 0.0001  # Gentle uptrend
                
            candles.append({
                "time": 1704067200 + i*3600,
                "open": base_price,
                "high": base_price + 0.0002,
                "low": base_price - 0.0002,
                "close": base_price + 0.0001,
                "volume": 1000
            })
        
        # Step 1: Calculate fast MA (10 period)
        print("Step 1: Calculate fast MA")
        request = {
            "id": "ma_fast",
            "command": "execute",
            "component_type": "indicator",
            "component_path": "core.indicators.trend.sma",
            "candles": candles,
            "params": {"period": 10}
        }
        server_process.stdin.write(json.dumps(request) + "\n")
        server_process.stdin.flush()
        
        response = json.loads(server_process.stdout.readline())
        print(f"Success: {response['success']}")
        ma_fast_values = response['result']['indicator_values']
        
        # Step 2: Calculate slow MA (30 period)
        print("\nStep 2: Calculate slow MA")
        request = {
            "id": "ma_slow",
            "command": "execute",
            "component_type": "indicator",
            "component_path": "core.indicators.trend.sma",
            "candles": candles,
            "params": {"period": 30}
        }
        server_process.stdin.write(json.dumps(request) + "\n")
        server_process.stdin.flush()
        
        response = json.loads(server_process.stdout.readline())
        print(f"Success: {response['success']}")
        ma_slow_values = response['result']['indicator_values']
        
        # Step 3: Execute MA crossover signal
        print("\nStep 3: Execute MA crossover signal")
        request = {
            "id": "ma_crossover",
            "command": "execute",
            "component_type": "signal",
            "component_path": "core.signals.ma_crossover",
            "candles": candles,
            "params": {"min_separation": 0.0001, "confirmation_bars": 1},
            "indicator_data": {
                "ma_fast": ma_fast_values,
                "ma_slow": ma_slow_values
            }
        }
        server_process.stdin.write(json.dumps(request) + "\n")
        server_process.stdin.flush()
        
        response = json.loads(server_process.stdout.readline())
        print(f"Success: {response['success']}")
        if response['success']:
            signals = response['result']['signals']
            print(f"Signals found: {len(signals)}")
            for signal in signals:
                print(f"  - {signal['timestamp']}: {signal['signal_type']} (strength: {signal['strength']:.3f})")
            print(f"Execution time: {response['result']['execution_time_ms']:.2f}ms")
        else:
            print(f"Error: {response.get('error', 'Unknown error')}")
        
        # Step 4: Test reusing cached components (should be faster)
        print("\nStep 4: Test component caching")
        start = time.time()
        request["id"] = "ma_crossover_cached"
        server_process.stdin.write(json.dumps(request) + "\n")
        server_process.stdin.flush()
        
        response = json.loads(server_process.stdout.readline())
        print(f"Cached execution time: {response['result']['execution_time_ms']:.2f}ms")
        
        # Shutdown
        request = {"id": "shutdown", "command": "shutdown"}
        server_process.stdin.write(json.dumps(request) + "\n")
        server_process.stdin.flush()
        
        server_process.wait(timeout=2)
        print("\nServer shut down successfully")
        
        # Check stderr for any logs
        stderr_output = server_process.stderr.read()
        if stderr_output:
            print("\nServer logs:")
            print(stderr_output)
            
    except Exception as e:
        print(f"Error: {e}")
        server_process.terminate()
        raise
        
if __name__ == "__main__":
    test_ma_crossover()