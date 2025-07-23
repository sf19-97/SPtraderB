# VERIFIED Complete File List for Bitcoin Chart & Data Pipeline

This document contains the complete, verified list of all files needed to share the Bitcoin implementation.

## 1. Critical Documentation ✅
```
data-ingestion/BITCOIN_CASCADE_PATTERN.md       # Modified: Jul 12 - THE CORE PATTERN
CLAUDE.md                                        # Project instructions  
docs/BITCOIN_DATABASE_SCHEMA.md                  # Modified: Jul 6 - DB schema
```

## 2. Data Ingestion Layer ✅

### Python Scripts (VERIFIED RUNNING)
```
data-ingestion/live/kraken/direct-bitcoin-ingester.py     # Modified: Jul 13 - Currently running (PID 56063)
```

### SQL Scripts (ALL VERIFIED)
```
data-ingestion/sql/bitcoin_schema_setup.sql               # Modified: Jul 6 - Tables & aggregates
data-ingestion/sql/bitcoin_cascade_refresh.sql            # Modified: Jul 10 - Main procedure
data-ingestion/sql/cascade_refresh_cron.sh                # Modified: Jul 14 - Clock-aligned script (ACTIVE)
```

### LaunchAgent Services (BOTH RUNNING)
```
/Users/sebastian/Library/LaunchAgents/com.sptraderb.bitcoin-ingester.plist      # Modified: Jul 11
/Users/sebastian/Library/LaunchAgents/com.sptraderb.bitcoin-cascade-refresh.plist # Modified: Jul 14
```

## 3. Backend (Rust/Tauri) ✅
```
src-tauri/src/commands/bitcoin_data.rs          # Modified: Jul 11 - Data queries
src-tauri/src/main.rs                           # Lines 2064-2067 register bitcoin commands
src-tauri/src/candle_monitor.rs                 # Modified: Jul 9 - Monitoring
src-tauri/Cargo.toml                           # Rust dependencies
```

## 4. Frontend Components ✅
```
src/components/BitcoinTestChart.tsx              # Modified: Jul 15 - Main chart (LATEST CHANGES)
src/components/BitcoinMarketDataBar.tsx          # Modified: Jul 10 - Market data
src/pages/BitcoinTest.tsx                        # Modified: Jul 8 - Test page
src/main.tsx                                     # Entry point with Mantine
src/App.tsx                                      # Routes (line 34: bitcoin-test route)
src/layouts/AppLayout.tsx                       # Navigation includes Bitcoin
```

## 5. Package Dependencies ✅
From package.json:
- lightweight-charts: ^5.0.7                    # Charting library
- @tauri-apps/api: ^2.0.1                      # IPC communication
- @mantine/*: ^8.1.0                           # UI components
- dayjs: ^1.11.13                              # Date handling

## 6. Current Production Status ✅
- **Ingester**: Running (direct-bitcoin-ingester.py)
- **Cascade**: Running every 5 seconds via cron.sh with clock alignment
- **Database**: forex_trading (PostgreSQL)
- **Procedure**: `cascade_bitcoin_aggregate_refresh()`
- **Log files**: Writing to cascade-refresh.log

## 7. Active Components
The cascade script:
- Runs every 5 seconds (not 30 as shown in old docs)
- Aligns to clock times: :01, :06, :11, :16, :21, :26, :31, :36, :41, :46, :51, :56
- Calls: `CALL cascade_bitcoin_aggregate_refresh();`

## 8. Key Implementation Notes
1. **No Docker/Pulsar/message queues** - Direct connections only
2. **Cascade order matters**: 1m → 5m → 15m → 1h → 4h → 12h
3. **Clock-aligned refresh**: Runs at specific seconds for consistent timing
4. **Placeholder candles**: Frontend creates instant candles at :00, real data arrives at :01

## 9. Database Requirements
- PostgreSQL 17 with TimescaleDB extension
- Database: `forex_trading`
- User: `postgres`

## 10. Environment Setup
The other dev will need:
1. PostgreSQL + TimescaleDB installed
2. Python 3.x with `websockets` and `psycopg2`
3. Rust/Cargo for Tauri backend
4. Node.js for frontend
5. macOS with launchd (or adapt for systemd/cron on Linux)

## Important Note
The BITCOIN_CASCADE_PATTERN.md file contains some outdated information:
- Shows 30-second interval instead of 5 seconds
- Shows old version of cascade_refresh_cron.sh without clock alignment
- Missing PostgreSQL path in LaunchAgent PATH

Use the actual files in this directory as the source of truth.