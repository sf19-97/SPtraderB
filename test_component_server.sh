#!/bin/bash

# Test the component server directly
cd /Users/sebastian/Projects/SPtraderB

echo "Testing component server..."
python3 src-tauri/src/orchestrator/component_server.py <<EOF
{"id": "test1", "command": "ping"}
{"id": "test2", "command": "get_metadata", "component_type": "signal", "component_path": "core/signals/ma_crossover.py"}
{"id": "shutdown", "command": "shutdown"}
EOF