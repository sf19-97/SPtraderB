# SPtraderB API Architecture

## Purpose

This API server provides **business logic and computation** for the SPtraderB trading platform. It does **NOT** handle real-time market data streaming - that's handled by the separate WebSocket Market Data Server.

## Separation of Concerns

```
┌─────────────────────────────────────────────────────────────┐
│          WebSocket Market Data Server (Separate)            │
│          ws-market-data-server.fly.dev                      │
│                                                             │
│  • Real-time broker connections (Binance, Oanda)          │
│  • Live market data streaming via WebSocket                │
│  • Client authentication for brokers                       │
│  • Tick/candle/orderbook/trade streaming                   │
│  • Already deployed and working                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│          SPtraderB API (This Server)                        │
│          sptraderb-api.fly.dev                             │
│                                                             │
│  • Backtesting engine (orchestrator)                       │
│  • Workspace management (save/load projects)               │
│  • Strategy management (YAML files)                        │
│  • Historical candle queries (for backtesting)             │
│  • Computational tasks                                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│          Frontend (Vercel)                                  │
│          your-app.vercel.app                               │
│                                                             │
│  Connects to BOTH servers:                                 │
│  • WebSocket server for real-time data                     │
│  • This API for backtesting/workspace/strategies           │
└─────────────────────────────────────────────────────────────┘
```

## API Endpoints

### Health Check
```
GET /health
Returns: {"status": "healthy", "version": "0.1.0"}
```

### Backtesting
```
POST   /api/backtest/run
GET    /api/backtest/:id/status
GET    /api/backtest/:id/results
POST   /api/backtest/:id/cancel
WS     /ws/backtest/:id
```

**Purpose**: Run backtests on historical data, track progress, retrieve results.

**Data Flow**:
1. Client sends backtest config (strategy, date range, symbols)
2. Server queries historical candles from PostgreSQL
3. Runs backtest engine (Rust orchestrator module)
4. Streams progress via WebSocket
5. Stores results in database
6. Returns results to client

### Workspace Management
```
GET    /api/workspace
POST   /api/workspace
GET    /api/workspace/:id
DELETE /api/workspace/:id
```

**Purpose**: Save and load user workspaces (IDE state, open files, configurations).

**Storage**: PostgreSQL or Fly.io volumes

### Strategy Management
```
GET    /api/strategies
GET    /api/strategies/:name
POST   /api/strategies/:name
```

**Purpose**: Load, save, and list trading strategy YAML files.

**Storage**: Fly.io volumes or PostgreSQL (small files)

### Historical Candles
```
GET /api/candles?symbol=EURUSD&timeframe=1h&from=...&to=...
```

**Purpose**: Query historical candle data for backtesting.

**Source**: PostgreSQL with TimescaleDB

**Note**: This is NOT for live data! Live candles come from the WebSocket server.

## Technology Stack

- **Web Framework**: Axum 0.7 (fast, type-safe)
- **Database**: PostgreSQL + TimescaleDB (time-series data)
- **Cache**: Redis (optional, for backtest results)
- **Async Runtime**: Tokio
- **Serialization**: Serde (JSON)
- **WebSocket**: Axum built-in WebSocket support
- **Logging**: Tracing + tracing-subscriber

## Modules

### `orchestrator/`
Backtesting engine implementation. Core business logic for:
- Loading strategies
- Running backtests
- Calculating metrics (PnL, drawdown, Sharpe ratio)
- Managing backtest lifecycle

**Dependencies**:
- `rust_decimal` for precise financial calculations
- `chrono` for date/time handling
- PostgreSQL for historical data

### `workspace/`
Workspace persistence. Handles:
- Saving workspace state (IDE, open files, config)
- Loading workspace by ID
- Listing user workspaces
- Cleanup/deletion

**Storage Options**:
1. PostgreSQL (JSON column) - Simple, works everywhere
2. Fly.io volumes - Faster, file-based
3. S3 - Scalable, pay-per-use

### `candles/`
Historical candle data queries. Provides:
- Efficient queries using TimescaleDB continuous aggregates
- Pagination support
- Metadata (data range, symbol info)

**Query Patterns**:
```sql
SELECT time, open, high, low, close, volume
FROM forex_candles_1h
WHERE symbol = $1 AND time >= $2 AND time <= $3
ORDER BY time ASC
```

### `execution/` & `orders/`
Order execution simulation for backtesting. NOT used for live trading.

## Database Schema

### `backtest_runs`
```sql
CREATE TABLE backtest_runs (
    id UUID PRIMARY KEY,
    strategy_name VARCHAR(255),
    symbol VARCHAR(20),
    timeframe VARCHAR(10),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    initial_capital DECIMAL,
    status VARCHAR(50),  -- 'running', 'completed', 'failed', 'cancelled'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    result JSONB  -- Store BacktestResults as JSON
);
```

### `workspaces`
```sql
CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    name VARCHAR(255),
    data JSONB,  -- Workspace state
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `forex_candles_*` (TimescaleDB)
Already exists from your existing setup:
- `forex_candles_5m`
- `forex_candles_15m`
- `forex_candles_1h`
- `forex_candles_4h`
- `forex_candles_12h`

## Environment Variables

```bash
# Database
DATABASE_URL=postgres://user:pass@host:5432/dbname

# Redis (optional)
REDIS_URL=redis://host:6379

# Server
PORT=3001

# Logging
RUST_LOG=info,sptraderb_api=debug
```

## Deployment

### Fly.io Configuration
- **Region**: US West (or nearest to users)
- **Instance**: shared-cpu-1x, 256MB RAM (start small)
- **Scaling**: Manual initially, can add autoscaling
- **Volumes**: Optional for strategy files

### Build Process
1. Docker multi-stage build
2. Rust release binary (~10MB)
3. Debian slim runtime (~100MB total image)

### Startup
1. Connect to PostgreSQL
2. Initialize Redis client
3. Run migrations (if needed)
4. Start HTTP server on $PORT
5. Register graceful shutdown handler

## Performance Characteristics

### Response Times (Target)
- Health check: < 5ms
- List operations: < 50ms
- Backtest start: < 100ms (queuing)
- Historical queries: < 200ms (1000 candles)

### Throughput
- Concurrent backtests: 5-10 (limited by CPU)
- HTTP requests: 1000+ req/s (health checks)
- WebSocket connections: 100+ (backtest progress)

### Resource Usage
- Memory: ~100MB base + ~50MB per active backtest
- CPU: Spikes during backtest computation
- Disk: Minimal (database is separate)

## Security

### CORS
Configured to allow requests from Vercel frontend domains.

### Authentication (TODO)
Options:
1. JWT tokens from frontend
2. API keys per user
3. Session-based auth

### Rate Limiting (TODO)
Implement rate limiting per client/IP:
- Backtest start: 10/hour
- API calls: 100/minute

## Monitoring

### Health Endpoint
`GET /health` returns server status.

### Metrics (TODO)
- Active backtests count
- Request rates
- Error rates
- Database connection pool status

### Logging
Structured logging with tracing:
- Request/response logging
- Backtest lifecycle events
- Errors with context

## Next Steps

1. **Port orchestrator logic** from `src-tauri/src/orchestrator/`
2. **Implement workspace storage** (PostgreSQL or volumes)
3. **Add authentication** (JWT or API keys)
4. **Set up monitoring** (Fly.io metrics + custom logs)
5. **Write tests** (integration + unit tests)
6. **Performance tuning** (connection pooling, caching)

## FAQ

**Q: Why not handle real-time data here too?**
A: The WebSocket Market Data Server is already doing this well. Don't duplicate effort.

**Q: Can backtests use live data?**
A: Backtests use historical data from PostgreSQL. For paper trading with live data, that would be a future feature connecting to the WebSocket server.

**Q: How long can backtests run?**
A: No timeout limits on Fly.io (unlike serverless). Backtests can run for hours if needed.

**Q: What about load balancing?**
A: Start with a single instance. Add more instances behind Fly.io's load balancer when needed.
