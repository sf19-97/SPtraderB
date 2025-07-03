#!/usr/bin/env python3
"""
Test script to verify IDE run functionality
"""

import time
import sys

print("Starting test script...")
print(f"Python version: {sys.version}")

# Simulate some work
start = time.time()
for i in range(5):
    print(f"Processing step {i+1}/5...")
    time.sleep(0.1)

elapsed = (time.time() - start) * 1000
print(f"\nCompleted in {elapsed:.2f}ms")

# Test stderr output
print("Testing stderr output...", file=sys.stderr)

# Test import
try:
    from core.base.indicator import Indicator
    print("✓ Successfully imported Indicator base class")
except ImportError as e:
    print(f"✗ Import error: {e}", file=sys.stderr)

print("\nTest complete!")