# OANDA Ingester Service

A standalone Rust service that streams real-time forex prices from OANDA's v20 API and publishes them to Apache Pulsar.

## Architecture

```
OANDA v20 API → SSE Stream → OANDA Ingester → Apache Pulsar → SPtraderB
```

## Prerequisites

- Rust 1.75+
- Apache Pulsar running locally (or accessible)
- OANDA account with API access

## Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your OANDA credentials:
   - `OANDA_ACCOUNT_ID`: Your OANDA account ID
   - `OANDA_API_TOKEN`: Your OANDA API token

3. (Optional) Modify `config/default.toml` for additional settings

## Running

### Development
```bash
# Install dependencies
cargo build

# Run with environment variables
cargo run

# Or with debug logging
RUST_LOG=oanda_ingester=debug cargo run
```

### Production
```bash
cargo build --release
./target/release/oanda-ingester
```

## Pulsar Topics

The service publishes to these topics:
- `persistent://public/default/market-data/forex/prices/{symbol}` - Price updates
- `persistent://public/default/market-data/forex/heartbeat` - Connection heartbeats
- `persistent://public/default/market-data/forex/status` - Service status updates

## Health Checks

- `http://localhost:8080/health` - Liveness check
- `http://localhost:8080/ready` - Readiness check
- `http://localhost:9090/metrics` - Prometheus metrics

## Development Status

- [x] Basic project structure
- [x] Configuration management
- [x] OANDA models
- [x] SSE client skeleton
- [x] Pulsar producer skeleton
- [ ] Complete SSE streaming implementation
- [ ] Health check endpoints
- [ ] Metrics collection
- [ ] Docker support
- [ ] Integration tests