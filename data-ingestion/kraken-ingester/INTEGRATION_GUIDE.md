# Kraken BTC/USD Integration Guide

## Overview
This guide covers testing the unified Pulsar pipeline with Bitcoin data, demonstrating both real-time streaming and historical data persistence.

## Current Status
- ✅ Real-time BTC/USD streaming from Kraken to Pulsar
- ✅ Topics: ticker, trades, spread under `market-data/crypto/raw/kraken/btcusd/`
- ⏳ Historical BTC data ingestion (to be implemented)
- ⏳ JDBC sink to TimescaleDB (to be configured)

## Testing Real-Time BTC Data

### 1. Verify Services Running
```bash
# Check Pulsar
ps aux | grep pulsar

# Check Kraken ingester
ps aux | grep kraken-ingester

# View real-time logs
tail -f tools/ingester.log
```

### 2. Consume from Pulsar Topics
```bash
# Install Pulsar client tools if needed
cd tools/apache-pulsar-3.2.0

# Consume ticker data
bin/pulsar-client consume \
  persistent://public/default/market-data/crypto/raw/kraken/btcusd/ticker \
  -s "test-subscription" \
  -n 10

# Consume trade data  
bin/pulsar-client consume \
  persistent://public/default/market-data/crypto/raw/kraken/btcusd/trades \
  -s "test-subscription" \
  -n 10
```

### 3. Verify Message Format
Expected ticker message:
```json
{
  "timestamp": "2025-01-06T10:40:07.869476Z",
  "symbol": "BTCUSD",
  "data": {
    "ask": ["108039.20000", 2, "2.72453243"],
    "bid": ["108039.10000", 0, "0.00565269"],
    "last": ["108039.10000", "0.00049300"],
    "volume": ["43.15997417", "141.63755867"]
  }
}
```

## Planned: Historical BTC Integration

### 1. Create Historical BTC Ingester
```python
# btc_historical_ingester.py
# Sources: CoinGecko API, CryptoCompare, or similar
# Publishes to: sptraderb/historical/crypto/btcusd/ohlcv
```

### 2. Configure JDBC Sink
```yaml
# btc-historical-sink-config.yaml
tenant: "sptraderb"
namespace: "historical"
name: "crypto-btc-sink"
inputs: ["persistent://sptraderb/historical/crypto/btcusd/ohlcv"]
sinkType: "jdbc-postgresql"
configs:
  userName: "postgres"
  password: "password"
  jdbcUrl: "jdbc:postgresql://localhost:5432/forex_trading"
  tableName: "crypto_ohlcv"
```

### 3. Create TimescaleDB Table
```sql
CREATE TABLE crypto_ohlcv (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    open DECIMAL(20, 8),
    high DECIMAL(20, 8),
    low DECIMAL(20, 8),
    close DECIMAL(20, 8),
    volume DECIMAL(20, 8)
);

-- Convert to hypertable
SELECT create_hypertable('crypto_ohlcv', 'time');

-- Create continuous aggregates for different timeframes
CREATE MATERIALIZED VIEW crypto_candles_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    symbol,
    first(open, time) as open,
    max(high) as high,
    min(low) as low,
    last(close, time) as close,
    sum(volume) as volume
FROM crypto_ohlcv
GROUP BY bucket, symbol;
```

## Unit Test Plan

### Test Script: `test_btc_pulsar_integration.py`
```python
import asyncio
import pulsar
import psycopg2
from datetime import datetime, timedelta

async def test_btc_pipeline():
    # 1. Connect to Pulsar
    client = pulsar.Client('pulsar://localhost:6650')
    
    # 2. Verify real-time data
    consumer = client.subscribe(
        'persistent://public/default/market-data/crypto/raw/kraken/btcusd/ticker',
        'test-consumer'
    )
    
    print("Checking real-time BTC data...")
    msg = consumer.receive(timeout_millis=5000)
    print(f"Received: {msg.data()}")
    consumer.acknowledge(msg)
    
    # 3. Test historical data flow (when implemented)
    # - Ingest 7 days of BTC history
    # - Verify it appears in Pulsar topic
    # - Confirm JDBC sink writes to TimescaleDB
    
    # 4. Query TimescaleDB
    conn = psycopg2.connect("postgresql://postgres@localhost:5432/forex_trading")
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM crypto_ohlcv WHERE symbol = 'BTCUSD'")
    count = cur.fetchone()[0]
    print(f"BTC records in database: {count}")
    
    client.close()
    return count > 0

if __name__ == "__main__":
    asyncio.run(test_btc_pipeline())
```

## Success Criteria
- [ ] Real-time BTC data visible in Pulsar topics
- [ ] Historical BTC data ingester implemented
- [ ] JDBC sink configured for historical namespace
- [ ] Data successfully written to TimescaleDB
- [ ] Continuous aggregates updating properly
- [ ] No conflicts between real-time and historical streams

## Benefits of This Approach
1. **Unified Pipeline**: All BTC data flows through Pulsar
2. **Selective Persistence**: Only historical data saved to DB
3. **Real-time Streaming**: Live prices available for trading
4. **Scalable**: Easy to add more crypto pairs
5. **Testable**: Clear separation of concerns