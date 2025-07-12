# Data Ingestion Pipeline

## Overview
This directory contains the data ingestion infrastructure for SPtraderB, handling both historical and real-time market data.

## Components

### Forex Data
- **`dukascopy_ingester.py`** - Downloads historical forex tick data from Dukascopy
  - Supports EURUSD, USDJPY, etc.
  - Stores in `forex_ticks` table
  - Creates continuous aggregates automatically

### Bitcoin Data
- **`dukascopy_bitcoin_ingester.py`** - Downloads historical Bitcoin data from Dukascopy
  - BTCUSD historical ticks
  - Stores in `bitcoin_ticks` table
  - Supports gap filling with `--fill-gaps` mode
  
- **`bitcoin-pulsar-consumer.py`** - Consumes real-time Bitcoin data from Pulsar
  - Reads from Kraken topics
  - Writes to `bitcoin_ticks` table
  - Handles both ticker and trades data

### Real-time Infrastructure
- **`kraken-ingester/`** - Rust service that streams Kraken WebSocket data to Pulsar
  - Connects to Kraken WebSocket API
  - Publishes to Pulsar topics:
    - `persistent://public/default/market-data/crypto/raw/kraken/btcusd/ticker`
    - `persistent://public/default/market-data/crypto/raw/kraken/btcusd/trades`
  - Contains Apache Pulsar installation in `tools/`

- **`oanda-ingester/`** - Rust service for OANDA forex streaming (future use)

### Auto Ingestion
- **`auto-ingester/`** - Automated forex data updates
  - Monitors for new data availability
  - Runs on schedule via cron

## Starting the Bitcoin Real-time Pipeline

```bash
# 1. Start Apache Pulsar
cd kraken-ingester/tools/apache-pulsar-3.2.0
./bin/pulsar standalone

# 2. Start Kraken WebSocket ingester (new terminal)
cd kraken-ingester
RUST_LOG=kraken_ingester=info ./target/release/kraken-ingester

# 3. Start Bitcoin Pulsar consumer (new terminal)
cd data-ingestion
python bitcoin-pulsar-consumer.py

# Verify data flow
psql -U sebastian -d forex_trading -c "SELECT COUNT(*) FROM bitcoin_ticks WHERE time > NOW() - INTERVAL '1 minute';"
```

## Database Schema

### Tables
- `forex_ticks` - Raw forex tick data
- `bitcoin_ticks` - Raw Bitcoin tick data
- `candles_*` - Continuous aggregates for forex (5m, 15m, 1h, 4h, 12h)
- `bitcoin_candles_*` - Continuous aggregates for Bitcoin

### Key SQL Files
- `bitcoin_schema_setup.sql` - Bitcoin table definitions

## Troubleshooting

### Pulsar Issues
- If BookKeeper errors: Kill Pulsar, use `--wipe-data` flag
- Connection refused: Wait 20-30 seconds for Pulsar to fully start
- Check ports: `lsof -i :6650 -i :8080 | grep LISTEN`

### Process Management
```bash
# Check running processes
ps aux | grep -E "(pulsar|kraken|bitcoin)"

# Kill all processes
pkill -f "pulsar standalone"
pkill -f "kraken-ingester" 
pkill -f "bitcoin-pulsar-consumer"
```

### Logs
- Kraken ingester: `kraken-ingester/kraken.log`
- Bitcoin consumer: `consumer.log`
- Pulsar: `kraken-ingester/tools/apache-pulsar-3.2.0/logs/pulsar-standalone.log`

## Architecture Vision

### Current State
- Historical data: Direct database writes
- Real-time data: Through Pulsar topics

### Future State
All data flows through Pulsar:
```
Data Sources → Pulsar Topics → Consumers → Database
                           ↓
                    Real-time Charts
```

This provides:
- Unified pipeline for all data
- Better reliability and monitoring
- Easier to add new data sources
- Scalable architecture