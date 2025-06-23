use async_trait::async_trait;
use chrono::Utc;
use log::info;
use rand::Rng;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::brokers::{AccountInfo, BrokerAPI, BrokerOrderResponse, Position, PositionSide};
use crate::orders::{Order, OrderSide, OrderStatus, OrderType};

pub struct MockBroker {
    connected: Arc<Mutex<bool>>,
    latency_ms: u64,
    failure_rate: f64,
    orders: Arc<Mutex<HashMap<String, Order>>>,
    positions: Arc<Mutex<HashMap<String, Position>>>,
    account_balance: Arc<Mutex<Decimal>>,
}

#[derive(Debug, Clone)]
pub struct MockBrokerConfig {
    pub latency_ms: u64,
    pub failure_rate: f64,
    pub initial_balance: Decimal,
}

impl Default for MockBrokerConfig {
    fn default() -> Self {
        Self {
            latency_ms: 50,
            failure_rate: 0.05,
            initial_balance: dec!(100000),
        }
    }
}

impl MockBroker {
    pub fn new(config: MockBrokerConfig) -> Self {
        Self {
            connected: Arc::new(Mutex::new(false)),
            latency_ms: config.latency_ms,
            failure_rate: config.failure_rate,
            orders: Arc::new(Mutex::new(HashMap::new())),
            positions: Arc::new(Mutex::new(HashMap::new())),
            account_balance: Arc::new(Mutex::new(config.initial_balance)),
        }
    }

    async fn simulate_latency(&self) {
        tokio::time::sleep(Duration::from_millis(self.latency_ms)).await;
    }

    fn should_fail(&self) -> bool {
        rand::thread_rng().gen::<f64>() < self.failure_rate
    }

    fn generate_mock_price(&self, symbol: &str) -> Decimal {
        // Generate realistic prices based on symbol
        match symbol {
            "EURUSD" => dec!(1.0850) + Decimal::from_f64_retain(rand::thread_rng().gen_range(-0.0050..0.0050)).unwrap(),
            "USDJPY" => dec!(150.50) + Decimal::from_f64_retain(rand::thread_rng().gen_range(-0.50..0.50)).unwrap(),
            "GBPUSD" => dec!(1.2750) + Decimal::from_f64_retain(rand::thread_rng().gen_range(-0.0075..0.0075)).unwrap(),
            _ => dec!(100.00) + Decimal::from_f64_retain(rand::thread_rng().gen_range(-1.0..1.0)).unwrap(),
        }
    }

    async fn execute_order(&self, order: &Order) -> Result<(Decimal, OrderStatus), String> {
        // Simulate order execution
        if self.should_fail() {
            return Ok((
                Decimal::ZERO,
                OrderStatus::Rejected {
                    reason: "Mock broker rejection: Insufficient margin".to_string(),
                },
            ));
        }

        let fill_price = match &order.order_type {
            OrderType::Market => self.generate_mock_price(&order.symbol),
            OrderType::Limit { price } => {
                // Simulate limit order - might fill at limit or better
                let market_price = self.generate_mock_price(&order.symbol);
                match order.side {
                    OrderSide::Buy => market_price.min(*price),
                    OrderSide::Sell => market_price.max(*price),
                }
            }
            _ => self.generate_mock_price(&order.symbol),
        };

        // Simulate partial fills occasionally
        if rand::thread_rng().gen::<f64>() < 0.1 {
            let filled_qty = order.quantity * Decimal::from_f64_retain(rand::thread_rng().gen_range(0.5..0.9)).unwrap();
            Ok((
                fill_price,
                OrderStatus::PartiallyFilled {
                    filled_qty,
                    last_fill_price: fill_price,
                    last_fill_time: Utc::now(),
                },
            ))
        } else {
            Ok((fill_price, OrderStatus::Filled))
        }
    }
}

#[async_trait]
impl BrokerAPI for MockBroker {
    async fn connect(&mut self) -> Result<(), String> {
        self.simulate_latency().await;
        
        // Simulate connection failure occasionally
        if self.should_fail() {
            return Err("Mock connection failed".to_string());
        }

        *self.connected.lock().await = true;
        info!("Mock broker connected");
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), String> {
        self.simulate_latency().await;
        *self.connected.lock().await = false;
        info!("Mock broker disconnected");
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected.try_lock().map(|g| *g).unwrap_or(false)
    }

    async fn ping(&self) -> Result<Duration, String> {
        if !self.is_connected() {
            return Err("Not connected".to_string());
        }

        let start = std::time::Instant::now();
        self.simulate_latency().await;
        Ok(start.elapsed())
    }

    async fn submit_order(&self, order: &Order) -> Result<BrokerOrderResponse, String> {
        if !self.is_connected() {
            return Err("Not connected to broker".to_string());
        }

        self.simulate_latency().await;

        // Generate broker order ID
        let broker_order_id = format!("MOCK-{}", Uuid::new_v4());

        // Execute the order
        let (fill_price, status) = self.execute_order(order).await?;

        // Store order
        let mut order_copy = order.clone();
        order_copy.broker_order_id = Some(broker_order_id.clone());
        order_copy.status = status.clone();
        
        if matches!(status, OrderStatus::Filled | OrderStatus::PartiallyFilled { .. }) {
            order_copy.average_fill_price = Some(fill_price);
            
            // Update position
            let mut positions = self.positions.lock().await;
            let position = positions.entry(order.symbol.clone()).or_insert(Position {
                symbol: order.symbol.clone(),
                side: match order.side {
                    OrderSide::Buy => PositionSide::Long,
                    OrderSide::Sell => PositionSide::Short,
                },
                quantity: Decimal::ZERO,
                average_price: fill_price,
                current_price: Some(fill_price),
                unrealized_pnl: Some(Decimal::ZERO),
                realized_pnl: Decimal::ZERO,
            });

            // Update position quantity
            match order.side {
                OrderSide::Buy => position.quantity += order.quantity,
                OrderSide::Sell => position.quantity -= order.quantity,
            }
        }

        self.orders.lock().await.insert(broker_order_id.clone(), order_copy);

        info!(
            "Mock broker executed order {} for {} {} @ {}",
            broker_order_id, order.quantity, order.symbol, fill_price
        );

        Ok(BrokerOrderResponse {
            broker_order_id,
            status,
            accepted_at: Utc::now(),
            message: Some(format!("Mock order executed at {}", fill_price)),
        })
    }

    async fn cancel_order(&self, order_id: &str) -> Result<(), String> {
        if !self.is_connected() {
            return Err("Not connected to broker".to_string());
        }

        self.simulate_latency().await;

        let mut orders = self.orders.lock().await;
        if let Some(order) = orders.get_mut(order_id) {
            match &order.status {
                OrderStatus::Submitted | OrderStatus::PendingSubmit => {
                    order.status = OrderStatus::Cancelled;
                    Ok(())
                }
                _ => Err(format!("Order {} cannot be cancelled in current state", order_id)),
            }
        } else {
            Err(format!("Order {} not found", order_id))
        }
    }

    async fn get_order_status(&self, order_id: &str) -> Result<OrderStatus, String> {
        if !self.is_connected() {
            return Err("Not connected to broker".to_string());
        }

        self.simulate_latency().await;

        let orders = self.orders.lock().await;
        orders
            .get(order_id)
            .map(|order| order.status.clone())
            .ok_or_else(|| format!("Order {} not found", order_id))
    }

    async fn get_account_info(&self) -> Result<AccountInfo, String> {
        if !self.is_connected() {
            return Err("Not connected to broker".to_string());
        }

        self.simulate_latency().await;

        let balance = *self.account_balance.lock().await;
        let margin_used = dec!(0); // Simplified - no margin calculation
        
        Ok(AccountInfo {
            account_id: "MOCK-001".to_string(),
            balance,
            buying_power: balance - margin_used,
            currency: "USD".to_string(),
            margin_used,
            margin_available: balance - margin_used,
        })
    }

    async fn get_positions(&self) -> Result<Vec<Position>, String> {
        if !self.is_connected() {
            return Err("Not connected to broker".to_string());
        }

        self.simulate_latency().await;

        let positions = self.positions.lock().await;
        Ok(positions.values().cloned().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orders::{Order, OrderSide, OrderType};

    #[tokio::test]
    async fn test_mock_broker_connection() {
        let mut broker = MockBroker::new(MockBrokerConfig::default());
        
        assert!(!broker.is_connected());
        
        broker.connect().await.unwrap();
        assert!(broker.is_connected());
        
        broker.disconnect().await.unwrap();
        assert!(!broker.is_connected());
    }

    #[tokio::test]
    async fn test_mock_broker_order_execution() {
        let mut broker = MockBroker::new(MockBrokerConfig {
            failure_rate: 0.0, // No failures for testing
            ..Default::default()
        });

        broker.connect().await.unwrap();

        let order = Order::new(
            "EURUSD".to_string(),
            OrderSide::Buy,
            dec!(1000),
            OrderType::Market,
            "test".to_string(),
        );

        let response = broker.submit_order(&order).await.unwrap();
        
        assert!(response.broker_order_id.starts_with("MOCK-"));
        assert!(matches!(
            response.status,
            OrderStatus::Filled | OrderStatus::PartiallyFilled { .. }
        ));
    }
}