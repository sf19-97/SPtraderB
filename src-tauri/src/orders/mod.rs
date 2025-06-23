use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

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

impl Order {
    pub fn new(
        symbol: String,
        side: OrderSide,
        quantity: Decimal,
        order_type: OrderType,
        component_name: String,
    ) -> Self {
        let now = Utc::now();
        let id = Uuid::new_v4();
        
        Self {
            id,
            client_order_id: format!("ORD-{}", id),
            broker_order_id: None,
            symbol,
            side,
            quantity,
            order_type,
            time_in_force: TimeInForce::GTC,
            expire_time: None,
            parent_order_id: None,
            linked_orders: Vec::new(),
            execution_instructions: ExecutionInstructions::default(),
            status: OrderStatus::Created,
            filled_quantity: Decimal::ZERO,
            remaining_quantity: quantity,
            average_fill_price: None,
            commission: None,
            max_slippage: None,
            position_size_check: true,
            created_at: now,
            updated_at: now,
            events: vec![OrderEvent {
                id: Uuid::new_v4(),
                order_id: id,
                event_type: OrderEventType::Created,
                timestamp: now,
                details: HashMap::new(),
            }],
            strategy_id: None,
            signal_id: None,
            component_name,
            metadata: HashMap::new(),
        }
    }

    pub fn add_event(&mut self, event_type: OrderEventType, details: HashMap<String, serde_json::Value>) {
        self.events.push(OrderEvent {
            id: Uuid::new_v4(),
            order_id: self.id,
            event_type,
            timestamp: Utc::now(),
            details,
        });
        self.updated_at = Utc::now();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderType {
    Market,
    Limit {
        price: Decimal,
    },
    Stop {
        stop_price: Decimal,
    },
    StopLimit {
        stop_price: Decimal,
        limit_price: Decimal,
    },
    TrailingStop {
        distance: Decimal,
        distance_type: DistanceType,
    },
    Custom {
        algorithm: String,
        params: HashMap<String, serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DistanceType {
    Price,
    Percentage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TimeInForce {
    GTC, // Good Till Cancelled
    GTD { expires_at: DateTime<Utc> }, // Good Till Date
    IOC, // Immediate or Cancel
    FOK, // Fill or Kill
    MOC, // Market on Close
    LOC, // Limit on Close
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExecutionInstructions {
    pub urgency: Urgency,
    pub display_size: Option<Decimal>,
    pub would_price_improve: bool,
    pub allow_partial_fills: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum Urgency {
    #[default]
    Normal,
    High,
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderEvent {
    pub id: Uuid,
    pub order_id: Uuid,
    pub event_type: OrderEventType,
    pub timestamp: DateTime<Utc>,
    pub details: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderEventType {
    Created,
    Validated,
    Submitted,
    Acknowledged,
    PartialFill,
    Filled,
    Cancelled,
    Rejected,
    Modified,
    Expired,
}

// Validation
pub fn validate_order(order: &Order) -> Result<(), String> {
    // Basic validation
    if order.quantity <= Decimal::ZERO {
        return Err("Order quantity must be positive".to_string());
    }

    if order.symbol.is_empty() {
        return Err("Order symbol cannot be empty".to_string());
    }

    // Price validation for limit orders
    match &order.order_type {
        OrderType::Limit { price } => {
            if *price <= Decimal::ZERO {
                return Err("Limit price must be positive".to_string());
            }
        }
        OrderType::Stop { stop_price } => {
            if *stop_price <= Decimal::ZERO {
                return Err("Stop price must be positive".to_string());
            }
        }
        OrderType::StopLimit {
            stop_price,
            limit_price,
        } => {
            if *stop_price <= Decimal::ZERO || *limit_price <= Decimal::ZERO {
                return Err("Stop and limit prices must be positive".to_string());
            }
        }
        _ => {}
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn test_order_creation() {
        let order = Order::new(
            "EURUSD".to_string(),
            OrderSide::Buy,
            dec!(1000),
            OrderType::Market,
            "test_component".to_string(),
        );

        assert_eq!(order.symbol, "EURUSD");
        assert_eq!(order.quantity, dec!(1000));
        assert_eq!(order.status, OrderStatus::Created);
        assert_eq!(order.events.len(), 1);
    }

    #[test]
    fn test_order_validation() {
        // Valid order
        let valid_order = Order::new(
            "EURUSD".to_string(),
            OrderSide::Buy,
            dec!(1000),
            OrderType::Market,
            "test_component".to_string(),
        );
        assert!(validate_order(&valid_order).is_ok());

        // Invalid quantity
        let mut invalid_order = valid_order.clone();
        invalid_order.quantity = dec!(-100);
        assert!(validate_order(&invalid_order).is_err());

        // Invalid limit price
        let mut invalid_limit = valid_order.clone();
        invalid_limit.order_type = OrderType::Limit { price: dec!(0) };
        assert!(validate_order(&invalid_limit).is_err());
    }
}