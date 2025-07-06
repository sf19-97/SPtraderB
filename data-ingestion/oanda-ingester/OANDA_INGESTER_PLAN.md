# OANDA Price Ingester Service Plan

## Overview
A standalone service that streams real-time price data from OANDA's v20 API and publishes it to Apache Pulsar topics. This service acts as a bridge between OANDA's streaming API and our Pulsar-based data pipeline.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OANDA v20 API                             │
│              (SSE Price Stream Endpoint)                     │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS/SSE
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                 OANDA Ingester Service                       │
│  - Maintains persistent SSE connection                       │
│  - Parses price events                                       │
│  - Handles reconnection logic                                │
│  - Publishes to Pulsar topics                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                    Apache Pulsar                             │
│  Topics:                                                     │
│  - market-data/forex/prices/{symbol}                        │
│  - market-data/forex/heartbeat                              │
│  - market-data/forex/status                                 │
└─────────────────────────────────────────────────────────────┘
```

## Service Structure

```
data-ingestion/oanda-ingester/
├── Cargo.toml                 # Rust dependencies
├── config/
│   ├── default.toml          # Default configuration
│   ├── practice.toml         # Practice account config
│   └── production.toml       # Live account config
├── src/
│   ├── main.rs              # Service entry point
│   ├── config.rs            # Configuration management
│   ├── oanda/
│   │   ├── mod.rs           # OANDA module
│   │   ├── client.rs        # SSE client implementation
│   │   ├── models.rs        # Price event models
│   │   └── auth.rs          # Authentication handling
│   ├── pulsar/
│   │   ├── mod.rs           # Pulsar module
│   │   ├── producer.rs      # Price event producer
│   │   └── schemas.rs       # Message schemas
│   └── health.rs            # Health check endpoint
├── Dockerfile               # Container definition
├── docker-compose.yml       # Local development setup
└── README.md               # Service documentation
```

## Core Dependencies

### Rust Crates
```toml
[dependencies]
# Async runtime
tokio = { version = "1.35", features = ["full"] }

# HTTP and SSE
reqwest = { version = "0.11", features = ["stream"] }
eventsource-client = "0.11"

# Pulsar client
pulsar = { version = "6.0", features = ["tokio-runtime"] }

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Configuration
config = "0.13"

# Logging
tracing = "0.1"
tracing-subscriber = "0.3"

# Error handling
anyhow = "1.0"
thiserror = "1.0"
```

## Implementation Phases

### Phase 1: Basic Streaming (Week 1)
- [ ] Set up Rust project structure
- [ ] Implement OANDA SSE client
- [ ] Parse price events
- [ ] Basic logging and error handling
- [ ] Manual testing with practice account

### Phase 2: Pulsar Integration (Week 2)
- [ ] Set up local Pulsar instance
- [ ] Implement Pulsar producer
- [ ] Define message schemas
- [ ] Add heartbeat monitoring
- [ ] Integration testing

### Phase 3: Production Readiness (Week 3)
- [ ] Implement reconnection logic
- [ ] Add metrics collection
- [ ] Create health check endpoint
- [ ] Docker containerization
- [ ] Deployment documentation

### Phase 4: Advanced Features (Week 4+)
- [ ] Multi-account support
- [ ] Dynamic symbol subscription
- [ ] Rate limit handling
- [ ] Circuit breaker pattern
- [ ] Monitoring dashboard

## Configuration Schema

```toml
[service]
name = "oanda-ingester"
environment = "practice"  # practice | production

[oanda]
api_url = "https://stream-fxpractice.oanda.com"
account_id = "101-001-1234567-001"
api_token = "${OANDA_API_TOKEN}"  # From environment

[oanda.streaming]
instruments = ["EUR_USD", "GBP_USD", "USD_JPY"]
snapshot = true  # Include initial price snapshot
include_home_conversions = false

[pulsar]
broker_url = "pulsar://localhost:6650"
producer_name = "oanda-ingester"
compression = "lz4"

[pulsar.topics]
prices = "persistent://public/default/market-data/forex/prices"
heartbeat = "persistent://public/default/market-data/forex/heartbeat"
status = "persistent://public/default/market-data/forex/status"

[monitoring]
health_check_port = 8080
metrics_port = 9090

[retry]
max_attempts = 5
initial_delay_ms = 1000
max_delay_ms = 60000
exponential_base = 2
```

## Message Schemas

### Price Event
```json
{
  "type": "PRICE",
  "instrument": "EUR_USD",
  "time": "2025-07-05T18:30:45.123Z",
  "bid": {
    "price": "1.08234",
    "liquidity": 10000000
  },
  "ask": {
    "price": "1.08245",
    "liquidity": 10000000
  },
  "closeout_bid": "1.08230",
  "closeout_ask": "1.08249",
  "status": "tradeable",
  "source": "oanda",
  "account": "practice-001"
}
```

### Heartbeat Event
```json
{
  "type": "HEARTBEAT",
  "time": "2025-07-05T18:30:50.000Z",
  "source": "oanda",
  "account": "practice-001"
}
```

## Error Handling Strategy

### Connection Failures
1. Exponential backoff with jitter
2. Max retry attempts before alerting
3. Preserve last known state
4. Emit status events to Pulsar

### Parse Errors
1. Log malformed events
2. Continue processing stream
3. Increment error metrics
4. Alert on high error rate

### Pulsar Failures
1. Buffer events in memory (bounded)
2. Retry with backoff
3. Spill to disk if needed
4. Alert operations team

## Monitoring & Observability

### Metrics (Prometheus)
- `oanda_ingester_prices_total` - Total prices received
- `oanda_ingester_errors_total` - Errors by type
- `oanda_ingester_connection_status` - Current connection state
- `oanda_ingester_latency_seconds` - Price event latency

### Logs (Structured)
- All price events (debug level)
- Connection state changes
- Errors with context
- Performance metrics

### Health Checks
- `/health` - Basic liveness
- `/ready` - Connected to OANDA & Pulsar
- `/metrics` - Prometheus metrics

## Deployment Options

### 1. Docker Container
```dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/oanda-ingester /usr/local/bin/
CMD ["oanda-ingester"]
```

### 2. Kubernetes
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oanda-ingester
spec:
  replicas: 1  # Only one to avoid duplicate prices
  template:
    spec:
      containers:
      - name: oanda-ingester
        image: oanda-ingester:latest
        env:
        - name: OANDA_API_TOKEN
          valueFrom:
            secretKeyRef:
              name: oanda-credentials
              key: api-token
```

### 3. Systemd Service
```ini
[Unit]
Description=OANDA Price Ingester
After=network.target pulsar.service

[Service]
Type=simple
ExecStart=/usr/local/bin/oanda-ingester
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Security Considerations

1. **API Token Management**
   - Never commit tokens to git
   - Use environment variables
   - Rotate tokens regularly
   - Use separate tokens for practice/live

2. **Network Security**
   - TLS for all connections
   - Verify OANDA certificates
   - Restrict outbound connections

3. **Data Privacy**
   - No logging of full API tokens
   - Careful with account numbers
   - Comply with data retention policies

## Testing Strategy

### Unit Tests
- Price parsing logic
- Reconnection behavior
- Error handling paths
- Configuration loading

### Integration Tests
- Mock OANDA SSE server
- Real Pulsar instance
- End-to-end flow
- Performance benchmarks

### Load Testing
- Handle high-frequency updates
- Memory usage under load
- Pulsar throughput limits
- Network interruptions

## Future Enhancements

1. **Multi-Broker Support**
   - Abstract broker interface
   - Add Interactive Brokers
   - Add Alpaca support

2. **Advanced Features**
   - Order book depth
   - Trade execution feed
   - Account updates stream
   - News event integration

3. **Analytics**
   - Spread analysis
   - Liquidity monitoring
   - Latency tracking
   - Volume profiling

## Development Timeline

- **Week 1**: Basic OANDA streaming working
- **Week 2**: Pulsar integration complete
- **Week 3**: Production-ready with monitoring
- **Week 4**: Deployed to practice account
- **Week 5**: Performance tuning
- **Week 6**: Production deployment

## Success Criteria

1. **Reliability**
   - 99.9% uptime during market hours
   - Automatic recovery from failures
   - No duplicate or lost prices

2. **Performance**
   - < 10ms ingestion latency
   - Handle 1000 prices/second
   - Minimal memory footprint

3. **Observability**
   - Full visibility into health
   - Alerting for anomalies
   - Performance dashboards

## Resources

- [OANDA v20 API Docs](https://developer.oanda.com/rest-live-v20/introduction/)
- [OANDA Streaming Guide](https://developer.oanda.com/rest-live-v20/streaming/)
- [Apache Pulsar Rust Client](https://github.com/streamnative/pulsar-rs)
- [Server-Sent Events Spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)