#!/bin/bash

echo "Testing Kraken WebSocket ingester (without Pulsar)"
echo "This will show real-time Bitcoin data from Kraken"
echo ""
echo "Since Pulsar isn't running, you'll see connection errors"
echo "but the WebSocket data will still be logged."
echo ""
echo "Press Ctrl+C to stop"
echo ""

RUST_LOG=kraken_ingester=info cargo run