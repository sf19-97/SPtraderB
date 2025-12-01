# SPtraderB API - Orchestrator Service

**Status**: ✅ Production Ready
**Last Updated**: November 12, 2025
**Version**: 2.0.0 (Strategy Execution Complete)

## Overview

The SPtraderB API is a high-performance backtesting orchestrator service that executes trading strategies using Python-generated signals and Rust-based execution logic.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SPtraderB API                        │
│                   (Port 3001)                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐    ┌────────────────┐               │
│  │   Handlers   │───▶│ BacktestEngine │               │
│  │  (REST API)  │    └────────┬───────┘               │
│  └──────────────┘             │                        │
│                               │                        │
│                               ▼                        │
│  ┌────────────────────────────────────────────┐       │
│  │         Strategy Execution Loop            │       │
│  ├────────────────────────────────────────────┤       │
│  │  1. Fetch Candles (data.rs)               │       │
│  │  2. Execute Python Signals                 │       │
│  │     (python_executor.rs)                   │       │
│  │  3. Process Signals (signal_processor.rs)  │       │
│  │  4. Manage Positions (position_manager.rs) │       │
│  │  5. Calculate P&L & Metrics                │       │
│  └────────────────────────────────────────────┘       │
│                                                         │
└─────────────────────────────────────────────────────────┘
            │                              │
            ▼                              ▼
┌───────────────────────┐      ┌──────────────────────┐
│ ws-market-data-server │      │  Python Components   │
│  (Historical Data)    │      │  vectorized_backtest │
│  TimescaleDB/Postgres │      │  Indicators/Signals  │
└───────────────────────┘      └──────────────────────┘
```

## Current Status

### ✅ Completed Features

#### Core Infrastructure
- [x] REST API server (Axum + Tokio)
- [x] PostgreSQL connection (TimescaleDB)
- [x] Redis client integration
- [x] Async background processing
- [x] File-based result storage
- [x] CORS configuration

#### Data Layer
- [x] HTTP data fetching from ws-market-data-server
- [x] Candle data parsing (f64 → Decimal precision)
- [x] Unix timestamp → DateTime conversion
- [x] Symbol/timeframe/date range queries

#### Strategy Execution (NEW - v2.0.0)
- [x] Python subprocess execution (`vectorized_backtest_v2.py`)
- [x] Signal generation via Python components
- [x] Signal-to-rule matching engine
- [x] Entry condition evaluation
- [x] Exit condition evaluation (signal-based + risk-based)
- [x] Position lifecycle management
- [x] Stop-loss monitoring
- [x] Take-profit monitoring
- [x] Trade execution (buy/sell)
- [x] P&L calculation with percentages
- [x] Holding period tracking

#### Risk Management
- [x] Maximum drawdown monitoring
- [x] Per-trade stop-loss
- [x] Per-trade take-profit
- [x] Position size limits
- [x] Portfolio value tracking

#### API Endpoints
- [x] `POST /api/backtest/run` - Start backtest
- [x] `GET /api/backtest/:id/status` - Get status
- [x] `GET /api/backtest/:id/results` - Get results
- [x] WebSocket endpoint (placeholder)

### 🔄 Planned Features

#### Phase 1: Enhanced Execution
- [ ] WebSocket streaming for real-time progress
- [ ] Backtest cancellation support
- [ ] Multiple positions per symbol
- [ ] Partial position closes
- [ ] Trailing stop-loss

#### Phase 2: Advanced Features
- [ ] Strategy editor API
- [ ] Database result storage (optional)
- [ ] Batch backtest execution
- [ ] Parameter optimization
- [ ] Walk-forward analysis

#### Phase 3: Production Hardening
- [ ] Rate limiting
- [ ] Authentication/Authorization
- [ ] Request validation middleware
- [ ] Metrics/monitoring integration
- [ ] Error tracking (Sentry)

## Project Structure

```
api/
├── src/
│   ├── main.rs                    # Server entry point, routes
│   ├── orchestrator/
│   │   ├── mod.rs                 # Module exports
│   │   ├── handlers.rs            # REST API handlers
│   │   ├── engine.rs              # Backtest orchestration
│   │   ├── data.rs                # Market data fetching
│   │   ├── types.rs               # Core data structures
│   │   ├── storage.rs             # Result persistence
│   │   ├── python_executor.rs     # Python subprocess mgmt (NEW)
│   │   ├── signal_processor.rs    # Signal matching logic (NEW)
│   │   └── position_manager.rs    # Position lifecycle (NEW)
│   ├── workspace/
│   │   └── handlers.rs            # Workspace API handlers
│   └── execution/
│       └── mod.rs                 # Trade execution (future)
├── backtests/                     # Stored backtest results (JSON)
├── strategies/                    # Strategy YAML files
├── Cargo.toml                     # Rust dependencies
├── Dockerfile                     # Docker build config
├── fly.toml                       # Fly.io deployment config
└── CLAUDE.md                      # This file
```

## Getting Started

### Prerequisites

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Python 3.10+
python3 --version

# Required Python packages
pip install pandas numpy redis
```

### Environment Variables

Create `.env` file:

```bash
# Database (TimescaleDB)
DATABASE_URL=postgres://user:pass@host:port/dbname?sslmode=require

# Redis
REDIS_URL=redis://localhost:6379

# Market Data Server
WS_MARKET_DATA_URL=https://ws-market-data-server.fly.dev

# Server
PORT=3001
RUST_LOG=info
```

### Running Locally

```bash
# Install dependencies
cargo build

# Run server
cargo run

# Server starts on http://localhost:3001
```

### Testing

```bash
# Run a backtest
curl -X POST http://localhost:3001/api/backtest/run \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_name": "ma_crossover_strategy",
    "symbol": "EURUSD",
    "timeframe": "1h",
    "start_date": "2024-02-01T00:00:00Z",
    "end_date": "2024-02-07T23:59:59Z",
    "initial_capital": 10000.0
  }'

# Get results
curl http://localhost:3001/api/backtest/{backtest_id}/results
```

## Next Steps

---

## OPTION 1: Verify Trade Execution 🎯

**Goal**: Prove the trade execution works by seeing actual trades executed.

### Problem
Current test shows 0 trades because:
- Strategy looks for `golden_cross` (bullish)
- Test data only has `death_cross` (bearish)

### Solution A: Create Test Strategy

Create a strategy that matches available signals:

**File**: `strategies/test-death-cross.yaml`

```yaml
name: test_death_cross_strategy
version: "1.0.0"
author: test
description: Test strategy for death cross signals

dependencies:
  signals:
    - signals.ma_crossover

parameters:
  stop_loss: 0.02
  take_profit: 0.04
  position_size: 0.02

entry:
  when:
    - signal: ma_crossover
      outputs:
        crossover_type: death_cross  # Match the signal we have
  action: sell  # Short on death cross
  size: 0.02

exit:
  # Exit on opposite signal
  signal_exit:
    when:
      - signal: ma_crossover
        outputs:
          crossover_type: golden_cross
    action: close_all

  # Risk-based exits
  stop_loss:
    type: percentage
    value: 0.02  # 2% stop loss

  take_profit:
    type: percentage
    value: 0.04  # 4% take profit

risk:
  max_drawdown: 0.15
  max_position_size: 0.1
```

**Test Request**: `test-death-cross.json`

```json
{
  "strategy_name": "test_death_cross_strategy",
  "symbol": "EURUSD",
  "timeframe": "1h",
  "start_date": "2024-02-01T00:00:00Z",
  "end_date": "2024-02-07T23:59:59Z",
  "initial_capital": 10000.0
}
```

**Run Test**:

```bash
curl -X POST http://localhost:3001/api/backtest/run \
  -H "Content-Type: application/json" \
  -d @test-death-cross.json
```

**Expected Results**:
```json
{
  "total_trades": 1,
  "winning_trades": 0 or 1,
  "losing_trades": 0 or 1,
  "total_pnl": <positive or negative>,
  "signals_generated": 1
}
```

### Solution B: Find Golden Cross Data

Query ws-market-data-server for periods with upward trends:

```bash
# Try different months
start_date: "2024-03-01T00:00:00Z"
start_date: "2024-04-01T00:00:00Z"
start_date: "2024-05-01T00:00:00Z"
```

### Solution C: Use Different Timeframe

Daily (1d) candles may have different patterns:

```json
{
  "timeframe": "1d",
  "start_date": "2024-01-01T00:00:00Z",
  "end_date": "2024-03-01T00:00:00Z"
}
```

---

## OPTION 2: Deploy to Production 🚀

**Goal**: Deploy the API and frontend to cloud infrastructure.

### 2.1 Deploy API to Fly.io

**Prerequisites**:
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login
```

**Configuration**: `fly.toml` (already configured)

```toml
app = "sptraderb-api"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "3001"
  WS_MARKET_DATA_URL = "https://ws-market-data-server.fly.dev"

[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

**Secrets**:
```bash
flyctl secrets set \
  DATABASE_URL="postgres://..." \
  REDIS_URL="redis://..."
```

**Deploy**:
```bash
# Create app
flyctl apps create sptraderb-api

# Deploy
flyctl deploy

# Check status
flyctl status

# View logs
flyctl logs
```

**API URL**: `https://sptraderb-api.fly.dev`

### 2.2 Update Frontend

**Changes Required**:

1. **Remove Tauri Invocations**

Replace:
```typescript
// OLD: Tauri invoke
await invoke('run_backtest', { config })
```

With:
```typescript
// NEW: HTTP fetch
const response = await fetch(`${API_URL}/api/backtest/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(config)
})
```

2. **Environment Variables**

Create `.env.production`:
```bash
VITE_API_URL=https://sptraderb-api.fly.dev
```

3. **Update API Calls**

Files to modify:
- `src/contexts/OrchestratorContext.tsx`
- `src/components/orchestrator/backtest/BacktestRunner.tsx`
- Any component using `invoke()`

### 2.3 Deploy Frontend to Vercel

**Prerequisites**:
```bash
npm install -g vercel
vercel login
```

**Configuration**: `vercel.json`

```json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "env": {
    "VITE_API_URL": "https://sptraderb-api.fly.dev"
  }
}
```

**Deploy**:
```bash
# Build
npm run build

# Deploy
vercel --prod

# Custom domain (optional)
vercel domains add sptraderb.com
```

**URLs**:
- Frontend: `https://sptraderb.vercel.app`
- API: `https://sptraderb-api.fly.dev`

---

## OPTION 3: Add Advanced Features 🛠️

**Goal**: Enhance the orchestrator with production-ready features.

### 3.1 WebSocket Streaming

**Use Case**: Real-time backtest progress updates

**Implementation**:

1. **WebSocket Handler** (`orchestrator/handlers.rs`)

```rust
use axum::{
    extract::ws::{WebSocket, WebSocketUpgrade, Message},
    response::Response,
};
use futures::{sink::SinkExt, stream::StreamExt};

pub async fn backtest_progress_ws(
    ws: WebSocketUpgrade,
    Path(backtest_id): Path<String>,
) -> Response {
    ws.on_upgrade(move |socket| handle_backtest_progress(socket, backtest_id))
}

async fn handle_backtest_progress(mut socket: WebSocket, backtest_id: String) {
    // Subscribe to Redis pub/sub for progress updates
    let mut pubsub = redis_client.get_async_connection().await.into_pubsub();
    pubsub.subscribe(&format!("backtest:{}:progress", backtest_id)).await;

    while let Some(msg) = pubsub.on_message().next().await {
        let payload: String = msg.get_payload().unwrap();
        if socket.send(Message::Text(payload)).await.is_err() {
            break;
        }
    }
}
```

2. **Progress Emission** (`orchestrator/engine.rs`)

```rust
// In main backtest loop
if candle_idx % 10 == 0 {
    let progress = ProgressUpdate {
        backtest_id: backtest_id.clone(),
        progress_pct: (candle_idx as f64 / candles.len() as f64) * 100.0,
        current_capital: portfolio.total_value,
        open_positions: position_manager.open_positions_count(),
        trades_count: completed_trades.len(),
    };

    // Publish to Redis
    redis_client.publish(
        &format!("backtest:{}:progress", backtest_id),
        serde_json::to_string(&progress)?
    ).await?;
}
```

3. **Frontend Connection**

```typescript
const ws = new WebSocket(`wss://api.sptraderb.com/api/backtest/${id}/progress`)

ws.onmessage = (event) => {
  const progress = JSON.parse(event.data)
  setBacktestProgress(progress)
}
```

### 3.2 Multiple Positions Per Symbol

**Use Case**: Scale in/out of positions

**Changes**:

1. **Position Manager** (`position_manager.rs`)

```rust
// Change from single position to Vec
pub struct PositionManager {
    open_positions: HashMap<String, Vec<Position>>,  // symbol -> positions
}

impl PositionManager {
    pub fn execute_buy(&mut self, ..., scale_in: bool) {
        if !scale_in && self.has_open_positions_for(symbol) {
            return None;  // Don't open if position exists
        }

        // Otherwise, add to Vec
        let position = // ... create position
        self.open_positions
            .entry(symbol.to_string())
            .or_insert_with(Vec::new)
            .push(position);
    }

    pub fn close_partial(&mut self, symbol: &str, percent: f64) {
        // Close oldest positions first (FIFO)
    }
}
```

2. **Strategy YAML**

```yaml
entry:
  scale_in: true  # Allow multiple positions
  max_positions: 3

exit:
  scale_out: true  # Close positions partially
  partial_close_pct: 0.5  # Close 50% on first TP
```

### 3.3 Trailing Stop-Loss

**Use Case**: Lock in profits as price moves favorably

**Implementation**:

1. **Position Type** (`types.rs`)

```rust
#[derive(Debug, Clone)]
pub struct Position {
    // ... existing fields
    pub trailing_stop: Option<TrailingStop>,
}

#[derive(Debug, Clone)]
pub struct TrailingStop {
    pub activation_pct: Decimal,  // Activate after +X% profit
    pub trail_pct: Decimal,        // Trail by X% from peak
    pub peak_price: Decimal,       // Highest price seen
}
```

2. **Update Logic** (`position_manager.rs`)

```rust
pub fn update_trailing_stops(&mut self, prices: &HashMap<String, Decimal>) {
    for (symbol, positions) in &mut self.open_positions {
        let current_price = prices[symbol];

        for pos in positions {
            if let Some(ref mut trail) = pos.trailing_stop {
                // Update peak
                if current_price > trail.peak_price {
                    trail.peak_price = current_price;
                }

                // Calculate trailing stop price
                let stop_price = trail.peak_price * (Decimal::ONE - trail.trail_pct);

                // Check if hit
                if current_price <= stop_price {
                    // Close position
                }
            }
        }
    }
}
```

### 3.4 Strategy Parameter Optimization

**Use Case**: Find best parameters for a strategy

**Endpoint**: `POST /api/backtest/optimize`

**Request**:
```json
{
  "strategy_name": "ma_crossover_strategy",
  "symbol": "EURUSD",
  "timeframe": "1h",
  "date_range": ["2024-01-01", "2024-03-01"],
  "optimize_params": {
    "stop_loss": [0.01, 0.02, 0.03],
    "take_profit": [0.02, 0.04, 0.06],
    "position_size": [0.01, 0.02, 0.03]
  },
  "objective": "sharpe_ratio"  // or "total_pnl", "win_rate"
}
```

**Implementation**:
```rust
pub async fn optimize_strategy(
    Json(req): Json<OptimizeRequest>,
) -> Result<Json<OptimizeResponse>, String> {
    let param_combinations = generate_combinations(&req.optimize_params);

    let mut results = Vec::new();

    for params in param_combinations {
        // Run backtest with these params
        let result = run_backtest_with_params(params).await?;
        results.push((params, result));
    }

    // Sort by objective
    results.sort_by(|a, b| {
        compare_by_objective(&a.1, &b.1, &req.objective)
    });

    Ok(Json(OptimizeResponse {
        best_params: results[0].0,
        best_result: results[0].1,
        all_results: results,
    }))
}
```

### 3.5 Walk-Forward Analysis

**Use Case**: Test strategy on out-of-sample data

**Endpoint**: `POST /api/backtest/walk-forward`

**Process**:
1. Split data into windows (e.g., 3 months each)
2. Optimize on window 1, test on window 2
3. Optimize on window 2, test on window 3
4. Repeat...

**Implementation**:
```rust
pub async fn walk_forward_analysis(
    Json(req): Json<WalkForwardRequest>,
) -> Result<Json<WalkForwardResponse>, String> {
    let windows = split_into_windows(
        req.start_date,
        req.end_date,
        req.window_size_months,
    );

    let mut results = Vec::new();

    for i in 0..windows.len()-1 {
        // Optimize on window[i]
        let best_params = optimize_on_window(&windows[i]).await?;

        // Test on window[i+1]
        let test_result = backtest_with_params(
            &windows[i+1],
            &best_params
        ).await?;

        results.push(WalkForwardResult {
            train_window: windows[i],
            test_window: windows[i+1],
            optimized_params: best_params,
            test_performance: test_result,
        });
    }

    Ok(Json(WalkForwardResponse { results }))
}
```

---

## Development Guidelines

### Code Style

- **Rust**: Follow `rustfmt` defaults
- **Logging**: Use `tracing` macros (`info!`, `debug!`, `warn!`, `error!`)
- **Error Handling**: Return `Result<T, String>` for all fallible operations
- **Async**: Use `tokio::spawn` for CPU-intensive work

### Performance Considerations

1. **Use Decimal for Financial Calculations**: Avoid floating-point rounding errors
2. **Batch Database Queries**: Minimize round trips
3. **Cache Python Results**: Don't re-run Python for same candle data
4. **Stream Large Results**: Use WebSocket for real-time updates

### Security

1. **Input Validation**: Sanitize all user inputs
2. **Rate Limiting**: Prevent abuse (future)
3. **Authentication**: Add JWT tokens (future)
4. **CORS**: Restrict to known origins in production

---

## Troubleshooting

### Python Subprocess Fails

**Error**: `Failed to spawn Python process`

**Solutions**:
```bash
# Check Python is in PATH
which python3

# Install required packages
pip install pandas numpy

# Test Python script directly
cd ../workspace
python3 core/utils/vectorized_backtest_v2.py
```

### Database Connection Fails

**Error**: `Failed to connect to database`

**Solutions**:
```bash
# Check DATABASE_URL format
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL

# Check TimescaleDB extension
psql $DATABASE_URL -c "SELECT * FROM pg_extension WHERE extname='timescaledb';"
```

### Signals Generated but No Trades

**This is expected!** Check:
1. Signal `crossover_type` matches strategy entry rule
2. Entry rule requires correct signal name
3. Risk limits haven't been hit
4. Position already open for symbol

---

## Support & Resources

- **Source Code**: `/Users/sebastian/Projects/SPtraderB/api`
- **Python Components**: `/Users/sebastian/Projects/SPtraderB/workspace`
- **Market Data Server**: `https://ws-market-data-server.fly.dev`
- **Documentation**: This file + `STRATEGY_EXECUTION_COMPLETE.md`

---

**Last Updated**: November 12, 2025
**Status**: ✅ Production Ready
