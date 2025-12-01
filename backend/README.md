# SPtraderB API

Rust backend API for SPtraderB trading platform.

## Development

### Prerequisites
- Rust 1.75+
- PostgreSQL 15+ with TimescaleDB
- Redis

### Setup

1. Copy environment variables:
```bash
cp .env.example .env
```

2. Edit `.env` with your database and Redis credentials

3. Run development server:
```bash
cargo run
```

The API will start on `http://localhost:3001`

### Testing

```bash
# Check health endpoint
curl http://localhost:3001/health

# Expected response:
# {"status":"healthy","version":"0.1.0"}
```

## Deployment

### Fly.io Deployment

1. Install Fly CLI:
```bash
curl -L https://fly.io/install.sh | sh
```

2. Login:
```bash
fly auth login
```

3. Create app:
```bash
fly launch
```

4. Set secrets:
```bash
fly secrets set DATABASE_URL="postgres://..."
fly secrets set REDIS_URL="redis://..."
```

5. Deploy:
```bash
fly deploy
```

### Fly.io Postgres Setup

```bash
# Create Postgres instance
fly postgres create --name sptraderb-db

# Attach to app
fly postgres attach sptraderb-db

# Connect and setup TimescaleDB
fly postgres connect -a sptraderb-db
# Then run: CREATE EXTENSION IF NOT EXISTS timescaledb;
```

## API Endpoints

### Health Check
```
GET /health
```

### Backtesting
```
POST   /api/backtest/run
GET    /api/backtest/:id/status
GET    /api/backtest/:id/results
POST   /api/backtest/:id/cancel
WS     /ws/backtest/:id
```

### Market Data Pipelines
```
POST   /api/pipelines/start
GET    /api/pipelines/status
DELETE /api/pipelines/:symbol
POST   /api/pipelines/restore
WS     /ws/pipelines
```

### Workspace
```
GET    /api/workspace/list
POST   /api/workspace/save
GET    /api/workspace/:id
DELETE /api/workspace/:id
```

### Candles
```
GET    /api/candles?symbol=EURUSD&timeframe=1h&from=...&to=...
```

### Strategies
```
GET    /api/strategies/list
GET    /api/strategies/:name
```

### Brokers
```
GET    /api/brokers/profiles
POST   /api/brokers/profiles
```

## Architecture

```
api/
├── src/
│   ├── main.rs              # Axum server setup
│   ├── orchestrator/        # Backtesting engine
│   │   ├── mod.rs
│   │   └── handlers.rs
│   ├── market_data/         # Pipeline management
│   │   ├── mod.rs
│   │   └── handlers.rs
│   ├── workspace/           # Workspace CRUD
│   │   ├── mod.rs
│   │   └── handlers.rs
│   ├── candles/             # Candle data queries
│   │   ├── mod.rs
│   │   └── handlers.rs
│   ├── brokers/             # Broker profiles
│   │   ├── mod.rs
│   │   └── handlers.rs
│   ├── database/            # Database utilities
│   ├── execution/           # Order execution
│   └── orders/              # Order management
├── Cargo.toml
├── Dockerfile
└── fly.toml
```

## Next Steps

1. **Copy business logic from src-tauri**: The handlers are stubs that need implementation
2. **Add authentication**: Implement JWT or session-based auth
3. **Database migrations**: Set up sqlx migrations for schema versioning
4. **Rate limiting**: Add rate limiting middleware
5. **Monitoring**: Add metrics and tracing
6. **Tests**: Add integration and unit tests
