# Order Execution System - Implementation Plan

## Executive Summary

This document outlines the plan for building an institutional-grade order execution system for SPtraderB. The system is designed to be modular, scalable, and support complex algorithmic trading while starting with a simple mock implementation.

## System Architecture

```
┌─────────────────────────┐
│   Python Order/Signal   │
│      Components         │
└───────────┬─────────────┘
            │ JSON
            ▼
┌─────────────────────────┐
│   Tauri Frontend        │
│   (OrderPreview)        │
└───────────┬─────────────┘
            │ Submit Order
            ▼
┌─────────────────────────┐
│   Redis Message Queue   │ ◄── Always On (even in dev)
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Rust Execution Engine │
│   - Validation          │
│   - Risk Checks         │
│   - Event Sourcing      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Broker Abstraction    │
│   Layer (Trait)         │
└───────────┬─────────────┘
            │
     ┌──────┴──────┬──────────┐
     ▼             ▼          ▼
┌─────────┐  ┌─────────┐  ┌─────────┐
│  Mock   │  │ OANDA   │  │  Future │
│ Broker  │  │Practice │  │ Brokers │
└─────────┘  └─────────┘  └─────────┘
```

## Core Design Principles

1. **Message Queue First**: All orders flow through Redis, even in development
2. **Event Sourcing**: Complete audit trail of every state change
3. **Configuration Driven**: Switch between mock/practice/live with config
4. **Fail Safe**: Default to rejecting orders if any validation fails
5. **Modular**: Each broker is a plugin implementing a common trait

## Order Domain Model

### Core Order Structure

```rust
use rust_decimal::Decimal;
use chrono::{DateTime, Utc};
use serde::{Serialize, Deserialize};
use uuid::Uuid;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    // Identity
    pub id: Uuid,
    pub client_order_id: String,
    pub broker_order_id: Option<String>,
    
    // Core fields
    pub symbol: String,
    pub side: OrderSide,
    pub quantity: Decimal,
    pub order_type: OrderType,
    
    // Timing
    pub time_in_force: TimeInForce,
    pub expire_time: Option<DateTime<Utc>>,
    
    // Advanced features
    pub conditions: Vec<OrderCondition>,
    pub parent_order_id: Option<Uuid>,
    pub linked_orders: Vec<Uuid>,
    
    // Execution
    pub execution_instructions: ExecutionInstructions,
    
    // State
    pub status: OrderStatus,
    pub filled_quantity: Decimal,
    pub remaining_quantity: Decimal,
    pub average_fill_price: Option<Decimal>,
    pub commission: Option<Decimal>,
    
    // Risk
    pub max_slippage: Option<Decimal>,
    pub position_size_check: bool,
    
    // Audit
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub events: Vec<OrderEvent>,
    
    // Metadata
    pub strategy_id: Option<String>,
    pub signal_id: Option<String>,
    pub component_name: String,
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderType {
    Market,
    Limit { 
        price: Decimal 
    },
    Stop { 
        stop_price: Decimal 
    },
    StopLimit { 
        stop_price: Decimal, 
        limit_price: Decimal 
    },
    TrailingStop { 
        distance: Decimal, 
        distance_type: DistanceType 
    },
    Iceberg { 
        display_quantity: Decimal,
        total_quantity: Decimal,
        variance: Decimal,
    },
    Custom { 
        algorithm: String, 
        params: HashMap<String, serde_json::Value> 
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TimeInForce {
    GTC,  // Good Till Cancelled
    GTD { expires_at: DateTime<Utc> },  // Good Till Date
    IOC,  // Immediate or Cancel
    FOK,  // Fill or Kill
    MOC,  // Market on Close
    LOC,  // Limit on Close
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderStatus {
    Created,
    Validated,
    PendingSubmit,
    Submitted,
    Acknowledged,
    PartiallyFilled { 
        filled_qty: Decimal,
        last_fill_price: Decimal,
        last_fill_time: DateTime<Utc>,
    },
    Filled,
    Cancelled,
    Rejected { reason: String },
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderCondition {
    pub condition_type: ConditionType,
    pub trigger_value: Decimal,
    pub comparison: Comparison,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionInstructions {
    pub urgency: Urgency,
    pub display_size: Option<Decimal>,
    pub would_price_improve: bool,
    pub allow_partial_fills: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderEvent {
    pub id: Uuid,
    pub order_id: Uuid,
    pub event_type: OrderEventType,
    pub timestamp: DateTime<Utc>,
    pub details: HashMap<String, serde_json::Value>,
}
```

## Database Schema

### SQLite (Development) → PostgreSQL (Production) Ready

```sql
-- Orders table (current state)
CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    client_order_id TEXT UNIQUE NOT NULL,
    broker_order_id TEXT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity DECIMAL(20,8) NOT NULL,
    order_type TEXT NOT NULL,
    order_params JSONB NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    metadata JSONB,
    INDEX idx_symbol (symbol),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);

-- Trades table (execution records)
CREATE TABLE trades (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity DECIMAL(20,8) NOT NULL,
    price DECIMAL(20,8) NOT NULL,
    commission DECIMAL(20,8),
    commission_currency TEXT,
    executed_at TIMESTAMP NOT NULL,
    broker_trade_id TEXT,
    venue TEXT,
    metadata JSONB,
    INDEX idx_order_id (order_id),
    INDEX idx_executed_at (executed_at)
);

-- Order events (event sourcing)
CREATE TABLE order_events (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL,
    INDEX idx_order_id (order_id),
    INDEX idx_created_at (created_at)
);

-- Position summary (cached view)
CREATE TABLE position_summary (
    symbol TEXT PRIMARY KEY,
    net_quantity DECIMAL(20,8) NOT NULL,
    average_price DECIMAL(20,8) NOT NULL,
    realized_pnl DECIMAL(20,8) DEFAULT 0,
    unrealized_pnl DECIMAL(20,8) DEFAULT 0,
    total_commission DECIMAL(20,8) DEFAULT 0,
    last_updated TIMESTAMP NOT NULL
);

-- Risk limits
CREATE TABLE risk_limits (
    id TEXT PRIMARY KEY,
    limit_type TEXT NOT NULL,
    symbol TEXT,
    max_position_size DECIMAL(20,8),
    max_order_size DECIMAL(20,8),
    max_daily_loss DECIMAL(20,8),
    current_daily_pnl DECIMAL(20,8) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP NOT NULL
);
```

## Message Queue Architecture

### Redis Streams for Order Flow

```rust
// Order submission flow
pub async fn submit_order(order: Order) -> Result<String> {
    // 1. Validate order structure
    validate_order(&order)?;
    
    // 2. Add to pending queue
    let order_json = serde_json::to_string(&order)?;
    redis.xadd(
        "orders:pending",
        &[("order", order_json), ("timestamp", Utc::now().to_rfc3339())]
    ).await?;
    
    // 3. Publish event for real-time updates
    redis.publish("orders:submitted", &order.id).await?;
    
    Ok(order.id.to_string())
}

// Execution engine consumer
pub async fn execution_loop(redis: &Client, broker: Arc<dyn BrokerAPI>) {
    loop {
        // Read from pending queue
        let entries = redis.xread(
            &["orders:pending"],
            &["$"],
            Some(1000)  // 1 second timeout
        ).await?;
        
        for entry in entries {
            let order: Order = serde_json::from_str(&entry.order)?;
            
            // Process order
            match process_order(order, &broker).await {
                Ok(result) => {
                    // Move to completed
                    redis.xadd("orders:completed", &result).await?;
                    // Remove from pending
                    redis.xdel("orders:pending", &entry.id).await?;
                }
                Err(e) => {
                    // Move to failed
                    redis.xadd("orders:failed", &[
                        ("order_id", order.id),
                        ("error", e.to_string())
                    ]).await?;
                }
            }
        }
    }
}
```

## Broker Abstraction Layer

### Trait Definition

```rust
#[async_trait]
pub trait BrokerAPI: Send + Sync {
    /// Connect to broker
    async fn connect(&mut self) -> Result<()>;
    
    /// Disconnect from broker
    async fn disconnect(&mut self) -> Result<()>;
    
    /// Check connection status
    fn is_connected(&self) -> bool;
    
    /// Get connection latency
    async fn ping(&self) -> Result<Duration>;
    
    /// Submit order
    async fn submit_order(&self, order: &Order) -> Result<BrokerOrderResponse>;
    
    /// Cancel order
    async fn cancel_order(&self, order_id: &str) -> Result<()>;
    
    /// Get order status
    async fn get_order_status(&self, order_id: &str) -> Result<OrderStatus>;
    
    /// Get account info
    async fn get_account_info(&self) -> Result<AccountInfo>;
    
    /// Get positions
    async fn get_positions(&self) -> Result<Vec<Position>>;
    
    /// Subscribe to order updates
    async fn subscribe_order_updates(&self, callback: OrderUpdateCallback) -> Result<()>;
}

pub struct BrokerOrderResponse {
    pub broker_order_id: String,
    pub status: OrderStatus,
    pub accepted_at: DateTime<Utc>,
    pub message: Option<String>,
}
```

### Mock Broker Implementation

```rust
pub struct MockBroker {
    connected: Arc<Mutex<bool>>,
    latency_ms: u64,
    failure_rate: f64,
    orders: Arc<Mutex<HashMap<String, Order>>>,
}

impl MockBroker {
    pub fn new(config: MockBrokerConfig) -> Self {
        Self {
            connected: Arc::new(Mutex::new(false)),
            latency_ms: config.latency_ms,
            failure_rate: config.failure_rate,
            orders: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    
    async fn simulate_latency(&self) {
        tokio::time::sleep(Duration::from_millis(self.latency_ms)).await;
    }
    
    fn should_fail(&self) -> bool {
        rand::random::<f64>() < self.failure_rate
    }
}

#[async_trait]
impl BrokerAPI for MockBroker {
    async fn submit_order(&self, order: &Order) -> Result<BrokerOrderResponse> {
        self.simulate_latency().await;
        
        if !*self.connected.lock().await {
            return Err("Not connected".into());
        }
        
        if self.should_fail() {
            return Err("Simulated broker rejection".into());
        }
        
        // Simulate order execution
        let broker_order_id = format!("MOCK-{}", Uuid::new_v4());
        
        // Store order
        self.orders.lock().await.insert(broker_order_id.clone(), order.clone());
        
        Ok(BrokerOrderResponse {
            broker_order_id,
            status: OrderStatus::Submitted,
            accepted_at: Utc::now(),
            message: Some("Mock order accepted".to_string()),
        })
    }
}
```

## Configuration System

### Environment-Based Configuration

```toml
# config/development.toml
[app]
environment = "development"
log_level = "debug"

[broker]
mode = "mock"
mock_latency_ms = 50
mock_failure_rate = 0.05

[redis]
url = "redis://localhost:6379"
db = 0

[database]
url = "sqlite://./data/dev.db"
pool_size = 5

# config/staging.toml
[app]
environment = "staging"
log_level = "info"

[broker]
mode = "practice"

[broker.oanda]
api_url = "https://api-fxpractice.oanda.com"
streaming_url = "https://stream-fxpractice.oanda.com"
account_id = "${OANDA_PRACTICE_ACCOUNT}"
api_token = "${OANDA_PRACTICE_TOKEN}"

[redis]
url = "${REDIS_URL}"
db = 1

[database]
url = "sqlite://./data/staging.db"
pool_size = 10

# config/production.toml
[app]
environment = "production"
log_level = "warn"

[broker]
mode = "live"

[broker.oanda]
api_url = "https://api-fxtrade.oanda.com"
streaming_url = "https://stream-fxtrade.oanda.com"
account_id = "${OANDA_LIVE_ACCOUNT}"
api_token = "${OANDA_LIVE_TOKEN}"

[redis]
url = "${REDIS_URL}"
db = 2
cluster_mode = true

[database]
url = "${DATABASE_URL}"  # PostgreSQL
pool_size = 20
```

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [x] Create order domain model
- [ ] Set up Redis integration
- [ ] Implement mock broker
- [ ] Create basic execution engine
- [ ] Set up SQLite database
- [ ] Wire OrderPreview to submit test orders
- [ ] Add basic logging and monitoring

**Deliverable**: Can submit orders through UI and see mock execution results

### Phase 2: OANDA Integration (Week 3-4)
- [ ] Implement OANDA REST API client
- [ ] Add streaming price feeds
- [ ] Create OANDA broker adapter
- [ ] Add order status streaming
- [ ] Implement position tracking
- [ ] Add connection management with retries

**Deliverable**: Can execute real orders on OANDA practice account

### Phase 3: Risk & Monitoring (Week 5-6)
- [ ] Add pre-trade risk checks
- [ ] Implement position limits
- [ ] Create circuit breakers
- [ ] Add P&L tracking
- [ ] Build monitoring dashboard
- [ ] Add alerting system

**Deliverable**: Production-ready risk management

### Phase 4: Advanced Features (Week 7-8)
- [ ] Add complex order types
- [ ] Implement order algorithms
- [ ] Create backtesting integration
- [ ] Add performance analytics
- [ ] Build order replay system
- [ ] Add more brokers

**Deliverable**: Full algorithmic trading capabilities

## Testing Strategy

### Unit Tests
```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_mock_broker_connection() {
        let broker = MockBroker::new(MockBrokerConfig::default());
        assert!(!broker.is_connected());
        
        broker.connect().await.unwrap();
        assert!(broker.is_connected());
    }
    
    #[tokio::test]
    async fn test_order_validation() {
        let order = Order {
            quantity: Decimal::new(-100, 0),  // Negative quantity
            ..Default::default()
        };
        
        assert!(validate_order(&order).is_err());
    }
}
```

### Integration Tests
- Mock broker end-to-end flow
- Redis message queue processing
- Database event sourcing
- Error handling and recovery

### System Tests
- OANDA practice account tests
- Latency measurements
- Stress testing with concurrent orders
- Network failure simulation

## Security Considerations

1. **API Key Management**
   - Use OS keychain for storage
   - Never log sensitive data
   - Rotate keys regularly

2. **Order Validation**
   - Validate all inputs
   - Check position limits
   - Verify account permissions

3. **Network Security**
   - TLS for all connections
   - Certificate pinning for brokers
   - Request signing where supported

4. **Audit Trail**
   - Log all order events
   - Immutable event store
   - Regular backups

## Performance Targets

- Order submission latency: < 10ms (to queue)
- Mock broker execution: < 100ms
- OANDA order execution: < 200ms (network dependent)
- Message queue throughput: > 1000 orders/second
- Database write throughput: > 5000 events/second

## Monitoring & Observability

1. **Metrics**
   - Order submission rate
   - Execution latency (p50, p95, p99)
   - Success/failure rates
   - Queue depth
   - Connection status

2. **Logging**
   - Structured JSON logs
   - Correlation IDs for tracing
   - Log aggregation with search

3. **Alerting**
   - Connection failures
   - High rejection rates
   - Queue backlog
   - Unusual latency

## Future Enhancements

1. **Multi-Broker Support**
   - Interactive Brokers
   - Alpaca
   - Binance
   - Custom FIX connections

2. **Advanced Order Types**
   - Iceberg orders
   - TWAP/VWAP algorithms
   - Smart order routing
   - Pairs trading

3. **Machine Learning Integration**
   - Execution quality optimization
   - Slippage prediction
   - Optimal timing algorithms

4. **Institutional Features**
   - FIX protocol support
   - Multi-account management
   - Compliance reporting
   - Prime broker integration