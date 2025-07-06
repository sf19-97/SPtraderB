# Data Ingestion - Unified Pipeline Architecture

## Vision
Transform market data management from technical "ingestion tasks" to a seamless, integrated experience where users simply add symbols through the Settings page and the system handles everything automatically.

## Current Architecture

### Real-Time Streaming (✅ Implemented)
- **OANDA Ingester**: Forex data via SSE → Pulsar topics
- **Kraken Ingester**: Crypto data via WebSocket → Pulsar topics
- **Apache Pulsar**: Central message broker at localhost:6650

### Historical Data (🔄 Direct to DB - To Be Unified)
- **Auto-Ingester**: Monitors Dukascopy availability
- **Direct Writes**: Currently bypasses Pulsar, writes directly to TimescaleDB
- **Cloud Monitor**: AWS Lambda checks data availability

## Future Architecture: Everything Through Pulsar

```
User adds symbol in Settings (e.g., AUDCAD, AAPL, TSLA)
                    ↓
         System automatically:
    ┌───────────────┴───────────────┐
    │  Creates Pulsar namespace/    │
    │  topic structure              │
    └───────────────┬───────────────┘
                    ↓
    ┌───────────────────────────────┐
    │     Apache Pulsar             │
    │  ┌─────────┬──────────────┐  │
    │  │Historical│  Real-time   │  │
    │  │Namespace │  Namespace   │  │
    │  └────┬────┴──────┬───────┘  │
    └───────┼───────────┼──────────┘
            ↓           ↓
     ┌──────┴────┐     No persistence
     │JDBC Sink  │     (streaming only)
     │to TimeDB  │
     └───────────┘
```

## Directory Structure

```
data-ingestion/
├── oanda-ingester/        # Forex real-time streaming
├── kraken-ingester/       # Crypto real-time streaming  
├── auto-ingester/         # Historical data monitoring
├── cloud-monitor/         # AWS Lambda for Dukascopy
├── tests/                 # Integration tests (planned)
└── dukascopy_ingester.py  # Historical tick downloader
```

## Key Benefits of Unified Pipeline

1. **User Experience**: Add market data like installing apps - simple, no technical knowledge needed
2. **Single Entry Point**: All data flows through Pulsar first
3. **Flexible Routing**: Historical → Database, Real-time → Streaming only  
4. **Easy Scaling**: New data sources just follow the pattern
5. **Better Monitoring**: One pipeline to monitor instead of many

## Quick Start

### 1. Start Pulsar
```bash
cd kraken-ingester/tools
./apache-pulsar-3.2.0/bin/pulsar standalone
```

### 2. Start Real-Time Ingesters
```bash
# Terminal 1: Kraken (crypto - runs 24/7)
cd kraken-ingester && cargo run

# Terminal 2: OANDA (forex - weekdays only)
cd oanda-ingester && cargo run
```

### 3. Start Historical Monitoring
```bash
cd auto-ingester && python monitor.py
```

## Environment Variables
- `OANDA_API_KEY`: Your OANDA API key
- `OANDA_ACCOUNT_ID`: Your OANDA account ID
- See individual service READMEs for more

## Testing
- Kraken provides 24/7 BTC data for testing
- OANDA requires forex market hours (Sunday 21:00 UTC - Friday 21:00 UTC)
- See `kraken-ingester/INTEGRATION_GUIDE.md` for BTC testing

## Future Improvements
1. Replace Data Ingestion page with Settings integration
2. Route historical data through Pulsar with JDBC sinks
3. Add more exchanges (Interactive Brokers, Alpaca, Binance)
4. Deploy Pulsar cluster for production scale

---

This unified pipeline architecture sets the foundation for a professional-grade trading platform where data management "just works" without manual intervention.