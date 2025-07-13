# Data Ingestion

Clean, organized data ingestion for SPtraderB.

## Directory Structure

```
data-ingestion/
├── live/                    # Production ingestion (running 24/7)
│   └── kraken/
│       └── direct-bitcoin-ingester.py   # Real-time BTC/USD from Kraken WebSocket
│
├── backfill/               # Manual historical data tools
│   └── dukascopy/
│       ├── dukascopy_ingester.py         # Forex historical data
│       └── dukascopy_bitcoin_ingester.py # Bitcoin historical data
│
├── sql/                    # Database setup and maintenance
│   ├── bitcoin_schema_setup.sql          # Initial Bitcoin tables
│   ├── create_bitcoin_1min_candles.sql   # 1-minute aggregate
│   ├── bitcoin_cascade_refresh.sql       # Cascade refresh procedure
│   └── [monitoring and setup scripts]
│
└── docs/                   # API documentation and references
    └── oanda_api_info.py   # OANDA API structure reference
```

## Live Ingestion

### Bitcoin (Kraken)
```bash
cd live/kraken
python3 direct-bitcoin-ingester.py
```
- Connects to Kraken WebSocket
- Writes directly to PostgreSQL `bitcoin_ticks` table
- Auto-reconnects on failure
- Runs via macOS launchd service

## Historical Backfill

### Dukascopy Forex
```bash
cd backfill/dukascopy
python3 dukascopy_ingester.py --symbol EURUSD --start 2024-01-01 --end 2024-01-31
```

### Dukascopy Bitcoin
```bash
cd backfill/dukascopy
python3 dukascopy_bitcoin_ingester.py --symbol BTCUSD --start 2024-01-01 --end 2024-01-31
```

## Database Setup

Run SQL scripts in order:
1. `sql/bitcoin_schema_setup.sql` - Create tables
2. `sql/create_bitcoin_1min_candles.sql` - Add 1m aggregates
3. `sql/bitcoin_cascade_refresh.sql` - Setup refresh policies

## Pattern for New Assets

1. Copy `live/kraken/direct-bitcoin-ingester.py`
2. Modify connection (broker WebSocket/API)
3. Adjust parsing for broker's data format
4. Keep same table structure
5. That's it

No Pulsar. No Docker. Direct connections only.