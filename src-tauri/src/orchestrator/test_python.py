#!/usr/bin/env python3
import sys
import os

print(f"Python version: {sys.version}")
print(f"Current working directory: {os.getcwd()}")
print(f"Script location: {os.path.abspath(__file__)}")
print(f"Python path: {sys.path}")