# Kraken WebSocket Ingester

Streams real-time cryptocurrency market data from Kraken's WebSocket API to Apache Pulsar.

## Features

- Real-time BTC/USD price streaming
- Ticker, trades, and spread data  
- No authentication required (public data)
- 24/7 availability (crypto never sleeps!)
- Publishes to Apache Pulsar for scalable consumption

## Current Status

✅ **COMPLETE - Full Pulsar Integration**
- WebSocket connection to `wss://ws.kraken.com`
- Real-time streaming to Pulsar topics
- Separate topics for ticker, trades, and spread data
- LZ4 compression for efficient transport

## Sample Output

```
📊 Ticker XBT/USD - {
  "a":["108172.70000",11,"11.70510914"],    // Ask: price, whole lots, volume
  "b":["108172.60000",0,"0.01505750"],      // Bid: price, whole lots, volume  
  "c":["108172.70000","0.00091079"],        // Last trade
  "h":["108262.20000","108379.00000"],      // High (today, last 24h)
  "l":["108157.50000","107829.70000"],      // Low (today, last 24h)
  "o":["108249.50000","108001.10000"],      // Open (today, last 24h)
  "p":["108216.20347","108148.01677"],      // VWAP (today, last 24h)
  "t":[890,15545],                           // Trade count
  "v":["6.14876826","162.71709597"]         // Volume
}

📈 Spread XBT/USD - [
  "108172.60000",    // Bid
  "108172.70000",    // Ask
  "1751765690.980",  // Timestamp
  "0.01505750",      // Bid volume
  "11.69128505"      // Ask volume
]
```

## Running

```bash
# Test WebSocket connection (no Pulsar needed)
RUST_LOG=kraken_ingester=info cargo run

# With Pulsar (TODO)
# docker-compose up -d
# cargo run
```

## Architecture

```
Kraken WebSocket API
    ↓
Kraken Ingester (this service)
    ↓
Apache Pulsar Topics:
- market-data/crypto/raw/kraken/btcusd/ticker
- market-data/crypto/raw/kraken/btcusd/trades  
- market-data/crypto/raw/kraken/btcusd/spread
    ↓
SPtraderB Orchestrator
```