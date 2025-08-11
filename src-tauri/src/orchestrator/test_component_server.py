#!/usr/bin/env python3
"""
Test script for the component server
"""

import json
import subprocess
import sys
import time

def test_component_server():
    # Start the component server
    server_process = subprocess.Popen(
        [sys.executable, "component_server.py"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )
    
    # Give it a moment to start
    time.sleep(0.5)
    
    try:
        # Test 1: Ping
        print("Test 1: Ping")
        request = {"id": "test1", "command": "ping"}
        server_process.stdin.write(json.dumps(request) + "\n")
        server_process.stdin.flush()
        
        response = server_process.stdout.readline()
        print(f"Response: {response}")
        
        # Test 2: Execute indicator (SMA)
        print("\nTest 2: Execute SMA indicator")
        candles = [
            {"time": 1704067200 + i*3600, "open": 1.08 + i*0.001, "high": 1.081 + i*0.001, 
             "low": 1.079 + i*0.001, "close": 1.08 + i*0.001, "volume": 1000}
            for i in range(50)
        ]
        
        request = {
            "id": "test2",
            "command": "execute",
            "component_type": "indicator",
            "component_path": "core.indicators.trend.sma",
            "candles": candles,
            "params": {"period": 20}
        }
        server_process.stdin.write(json.dumps(request) + "\n")
        server_process.stdin.flush()
        
        response = server_process.stdout.readline()
        result = json.loads(response)
        print(f"Success: {result['success']}")
        if result['success']:
            print(f"Indicator values (last 5): {result['result']['indicator_values'][-5:]}")
            print(f"Execution time: {result['result']['execution_time_ms']:.2f}ms")
        
        # Test 3: Shutdown
        print("\nTest 3: Shutdown")
        request = {"id": "test3", "command": "shutdown"}
        server_process.stdin.write(json.dumps(request) + "\n")
        server_process.stdin.flush()
        
        response = server_process.stdout.readline()
        print(f"Response: {response}")
        
        # Wait for process to exit
        server_process.wait(timeout=2)
        print("Server shut down successfully")
        
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
    test_component_server()