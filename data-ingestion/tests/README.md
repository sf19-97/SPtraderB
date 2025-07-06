# Pulsar Integration Tests

This directory contains integration tests for the unified Pulsar-based data pipeline.

## BTC/USD Integration Test

Tests the complete data flow for Bitcoin through Pulsar, demonstrating both real-time streaming and (planned) historical data persistence.

### Prerequisites

1. Apache Pulsar running:
   ```bash
   cd ../kraken-ingester/tools
   ./apache-pulsar-3.2.0/bin/pulsar standalone
   ```

2. Kraken ingester streaming:
   ```bash
   cd ../kraken-ingester
   cargo run
   ```

3. Python dependencies:
   ```bash
   pip install pulsar-client psycopg2-binary requests
   ```

### Running the Test

```bash
python btc_pulsar_integration_test.py
```

### What It Tests

1. **Pulsar Connection** ✅
   - Verifies Pulsar is accessible at localhost:6650

2. **Real-time BTC Data** ✅
   - Subscribes to Kraken ticker topic
   - Receives and validates live price data

3. **Historical Data Ingestion** ⏳
   - Placeholder for future implementation
   - Will ingest 7 days of BTC history
   - Route through Pulsar historical namespace

4. **Database Integration** ⏳
   - Checks for crypto tables
   - Will verify JDBC sink writes

### Expected Output

```
BTC/USD Pulsar Integration Test
================================

1. Testing Pulsar connection...
   ✅ Connected to Pulsar

2. Testing real-time BTC data flow...
   Subscribed to persistent://public/default/market-data/crypto/raw/kraken/btcusd/ticker
   Waiting for messages (5 second timeout)...
   ✅ Received BTC ticker data:
      Timestamp: 2025-01-06T15:30:45.123Z
      Symbol: BTCUSD
      Price: $108039.10

3. Testing historical BTC data ingestion...
   ⏳ Historical BTC ingestion not yet implemented
   
4. Verifying database setup...
   ℹ️  No crypto tables found yet (expected)
```

### Next Steps

1. **Implement Historical Ingester**
   - Create `btc_historical_ingester.py`
   - Use free API (CoinGecko/Binance)
   - Publish to Pulsar historical topics

2. **Configure JDBC Sink**
   - Create sink configuration
   - Map to TimescaleDB tables
   - Test data persistence

3. **Complete Integration**
   - Both streams flowing through Pulsar
   - Selective persistence working
   - Unified pipeline proven