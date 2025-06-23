# Order Execution Architecture

## Overview
This document outlines the architecture for implementing real order execution in SPtraderB, from the Python order components to broker APIs.

## System Architecture

```
┌─────────────────────┐
│   Python Order      │
│   Component         │
└──────────┬──────────┘
           │ Output JSON
           ▼
┌─────────────────────┐
│   Tauri/Rust        │
│   Execution Engine  │
└──────────┬──────────┘
           │ 
           ▼
┌─────────────────────┐
│   Broker API        │
│   Abstraction Layer │
└──────────┬──────────┘
           │
     ┌─────┴─────┬─────────┬──────────┐
     ▼           ▼         ▼          ▼
┌─────────┐ ┌─────────┐ ┌──────┐ ┌────────┐
│  OANDA  │ │   IB    │ │Alpaca│ │Binance │
└─────────┘ └─────────┘ └──────┘ └────────┘
```

## Phase 1: Foundation (Start Here)

### 1.1 Define Order Types and Structures

**File**: `/src-tauri/src/orders/mod.rs`
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderType {
    Market,
    Limit { price: f64 },
    Stop { price: f64 },
    StopLimit { stop_price: f64, limit_price: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TimeInForce {
    GTC,  // Good Till Cancelled
    IOC,  // Immediate or Cancel
    FOK,  // Fill or Kill
    GTD { expires_at: i64 },  // Good Till Date
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderRequest {
    pub symbol: String,
    pub side: OrderSide,
    pub order_type: OrderType,
    pub quantity: f64,
    pub time_in_force: TimeInForce,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderStatus {
    Pending,
    Submitted,
    PartiallyFilled { filled_qty: f64 },
    Filled,
    Cancelled,
    Rejected { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderResponse {
    pub order_id: String,
    pub status: OrderStatus,
    pub filled_price: Option<f64>,
    pub filled_quantity: Option<f64>,
    pub commission: Option<f64>,
    pub timestamp: i64,
}
```

### 1.2 Create Broker Trait

**File**: `/src-tauri/src/brokers/mod.rs`
```rust
use async_trait::async_trait;
use crate::orders::{OrderRequest, OrderResponse};

#[async_trait]
pub trait BrokerAPI: Send + Sync {
    /// Connect to the broker
    async fn connect(&mut self) -> Result<(), String>;
    
    /// Disconnect from the broker
    async fn disconnect(&mut self) -> Result<(), String>;
    
    /// Check if connected
    fn is_connected(&self) -> bool;
    
    /// Submit an order
    async fn submit_order(&self, order: OrderRequest) -> Result<OrderResponse, String>;
    
    /// Cancel an order
    async fn cancel_order(&self, order_id: &str) -> Result<(), String>;
    
    /// Get order status
    async fn get_order_status(&self, order_id: &str) -> Result<OrderResponse, String>;
    
    /// Get account info
    async fn get_account_info(&self) -> Result<AccountInfo, String>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInfo {
    pub balance: f64,
    pub buying_power: f64,
    pub currency: String,
    pub open_positions: Vec<Position>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub symbol: String,
    pub quantity: f64,
    pub average_price: f64,
    pub current_price: f64,
    pub unrealized_pnl: f64,
}
```

### 1.3 Python Order Component Standard

**File**: `/workspace/core/orders/order_base.py`
```python
"""
Base class for all order components
"""
from abc import ABC, abstractmethod
from typing import Dict, Optional, Any
import json

class OrderBase(ABC):
    """
    Base class that all order components must inherit from
    """
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        
    @abstractmethod
    def generate_order(self, market_data: Dict[str, Any], signal: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Generate an order based on market data and optional signal
        
        Args:
            market_data: Current market state including bid, ask, last price
            signal: Optional signal that triggered this order
            
        Returns:
            Order specification dictionary
        """
        pass
    
    def validate_order(self, order: Dict[str, Any]) -> bool:
        """
        Validate order before submission
        """
        required_fields = ['symbol', 'side', 'order_type', 'quantity']
        return all(field in order for field in required_fields)
    
    def to_json(self, order: Dict[str, Any]) -> str:
        """
        Convert order to JSON for transmission to Rust
        """
        return json.dumps({
            'type': 'order_request',
            'order': order,
            'metadata': {
                'component': self.__class__.__name__,
                'version': getattr(self, '__version__', '1.0')
            }
        })

# Example metadata format
__metadata__ = {
    'name': 'order_base',
    'type': 'order',
    'category': 'base',
    'description': 'Base class for order components',
    'inputs': ['market_data', 'signal'],
    'outputs': ['order_request'],
    'parameters': {},
    'risk_limits': {
        'max_position_size': 10000,
        'max_order_value': 100000
    }
}
```

## Phase 2: Mock Broker Implementation

### 2.1 Create a Mock Broker for Testing

**File**: `/src-tauri/src/brokers/mock_broker.rs`
```rust
use async_trait::async_trait;
use crate::brokers::{BrokerAPI, AccountInfo, Position};
use crate::orders::{OrderRequest, OrderResponse, OrderStatus};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use uuid::Uuid;

pub struct MockBroker {
    connected: bool,
    orders: Arc<Mutex<HashMap<String, OrderResponse>>>,
    latency_ms: u64,
}

impl MockBroker {
    pub fn new(latency_ms: u64) -> Self {
        Self {
            connected: false,
            orders: Arc::new(Mutex::new(HashMap::new())),
            latency_ms,
        }
    }
}

#[async_trait]
impl BrokerAPI for MockBroker {
    async fn connect(&mut self) -> Result<(), String> {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        self.connected = true;
        Ok(())
    }
    
    async fn disconnect(&mut self) -> Result<(), String> {
        self.connected = false;
        Ok(())
    }
    
    fn is_connected(&self) -> bool {
        self.connected
    }
    
    async fn submit_order(&self, order: OrderRequest) -> Result<OrderResponse, String> {
        if !self.connected {
            return Err("Not connected to broker".to_string());
        }
        
        // Simulate network latency
        tokio::time::sleep(tokio::time::Duration::from_millis(self.latency_ms)).await;
        
        // Generate order ID
        let order_id = Uuid::new_v4().to_string();
        
        // Simulate order execution
        let status = if rand::random::<f64>() > 0.1 {
            OrderStatus::Filled
        } else {
            OrderStatus::Rejected { reason: "Insufficient margin".to_string() }
        };
        
        let response = OrderResponse {
            order_id: order_id.clone(),
            status,
            filled_price: Some(100.0), // Mock price
            filled_quantity: Some(order.quantity),
            commission: Some(0.01 * order.quantity),
            timestamp: chrono::Utc::now().timestamp(),
        };
        
        // Store order
        self.orders.lock().unwrap().insert(order_id, response.clone());
        
        Ok(response)
    }
    
    // ... implement other methods
}
```

## Phase 3: Execution Engine

### 3.1 Order Execution Pipeline

**File**: `/src-tauri/src/execution/engine.rs`
```rust
use crate::brokers::BrokerAPI;
use crate::orders::{OrderRequest, OrderResponse};
use tokio::sync::mpsc;
use std::sync::Arc;

pub struct ExecutionEngine {
    broker: Arc<dyn BrokerAPI>,
    order_tx: mpsc::Sender<OrderRequest>,
    response_tx: mpsc::Sender<OrderResponse>,
}

impl ExecutionEngine {
    pub fn new(
        broker: Arc<dyn BrokerAPI>,
        response_tx: mpsc::Sender<OrderResponse>,
    ) -> (Self, mpsc::Receiver<OrderRequest>) {
        let (order_tx, order_rx) = mpsc::channel(100);
        
        let engine = Self {
            broker,
            order_tx,
            response_tx,
        };
        
        (engine, order_rx)
    }
    
    pub async fn run(self, mut order_rx: mpsc::Receiver<OrderRequest>) {
        while let Some(order) = order_rx.recv().await {
            let broker = self.broker.clone();
            let response_tx = self.response_tx.clone();
            
            // Spawn task for each order
            tokio::spawn(async move {
                match broker.submit_order(order).await {
                    Ok(response) => {
                        let _ = response_tx.send(response).await;
                    }
                    Err(e) => {
                        eprintln!("Order execution failed: {}", e);
                    }
                }
            });
        }
    }
}
```

## Phase 4: Integration with IDE

### 4.1 Tauri Commands

**File**: `/src-tauri/src/main.rs` (additions)
```rust
#[tauri::command]
async fn test_order_execution(
    state: State<'_, AppState>,
    order_json: String,
) -> Result<OrderResponse, String> {
    // Parse order from Python component output
    let order: OrderRequest = serde_json::from_str(&order_json)
        .map_err(|e| format!("Failed to parse order: {}", e))?;
    
    // Get active broker
    let broker = state.get_active_broker().await?;
    
    // Submit order
    broker.submit_order(order).await
}

#[tauri::command]
async fn get_broker_connection_status(
    state: State<'_, AppState>,
) -> Result<ConnectionStatus, String> {
    let broker = state.get_active_broker().await?;
    
    Ok(ConnectionStatus {
        connected: broker.is_connected(),
        latency_ms: measure_latency(&broker).await,
    })
}
```

### 4.2 Frontend Integration

**File**: `/src/components/OrderPreview.tsx` (modifications)
```typescript
const runTest = async (type: string) => {
  setTestStatus('running');
  setTestResults(null);
  
  try {
    // Get the current code from Monaco editor
    const orderCode = getCurrentCode(); // This would come from MonacoIDE
    
    // Run the Python component to get order JSON
    const componentOutput = await invoke('run_component', {
      filePath: selectedFile,
      envVars: {
        TEST_MODE: 'true',
        BROKER_PROFILE: activeProfileId
      }
    });
    
    // Extract order JSON from output
    const orderJson = extractOrderJson(componentOutput);
    
    // Test order execution
    const result = await invoke('test_order_execution', {
      orderJson
    });
    
    setTestStatus('complete');
    setTestResults({
      type,
      executionTime: result.execution_time_ms,
      slippage: calculateSlippage(result),
      status: result.status,
      timestamp: new Date().toLocaleTimeString()
    });
  } catch (error) {
    console.error('Order test failed:', error);
    setTestStatus('complete');
  }
};
```

## Implementation Steps

1. **Start with Phase 1**: Create the basic data structures
2. **Implement Mock Broker**: Test the system without real money
3. **Build Execution Engine**: Handle order flow and state
4. **Wire up IDE**: Connect Python components to execution
5. **Add Real Brokers**: One at a time, starting with paper trading

## Testing Strategy

1. **Unit Tests**: Test each component in isolation
2. **Integration Tests**: Test Python → Rust → Mock Broker flow
3. **Paper Trading**: Test with broker paper accounts
4. **Gradual Rollout**: Start with small positions

## Security Checklist

- [ ] Encrypt API keys with OS keychain
- [ ] Implement position size limits
- [ ] Add emergency stop button
- [ ] Log all orders for audit
- [ ] Rate limit order submissions
- [ ] Validate all inputs from Python
- [ ] Implement circuit breakers