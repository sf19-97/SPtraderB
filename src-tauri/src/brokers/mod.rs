use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::orders::{Order, OrderStatus};

pub mod mock_broker;

#[async_trait]
pub trait BrokerAPI: Send + Sync {
    /// Connect to broker
    async fn connect(&mut self) -> Result<(), String>;

    /// Disconnect from broker
    async fn disconnect(&mut self) -> Result<(), String>;

    /// Check connection status
    fn is_connected(&self) -> bool;

    /// Get connection latency
    async fn ping(&self) -> Result<Duration, String>;

    /// Submit order
    async fn submit_order(&self, order: &Order) -> Result<BrokerOrderResponse, String>;

    /// Cancel order
    async fn cancel_order(&self, order_id: &str) -> Result<(), String>;

    /// Get order status
    async fn get_order_status(&self, order_id: &str) -> Result<OrderStatus, String>;

    /// Get account info
    async fn get_account_info(&self) -> Result<AccountInfo, String>;

    /// Get positions
    async fn get_positions(&self) -> Result<Vec<Position>, String>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerOrderResponse {
    pub broker_order_id: String,
    pub status: OrderStatus,
    pub accepted_at: DateTime<Utc>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInfo {
    pub account_id: String,
    pub balance: Decimal,
    pub buying_power: Decimal,
    pub currency: String,
    pub margin_used: Decimal,
    pub margin_available: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub symbol: String,
    pub side: PositionSide,
    pub quantity: Decimal,
    pub average_price: Decimal,
    pub current_price: Option<Decimal>,
    pub unrealized_pnl: Option<Decimal>,
    pub realized_pnl: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PositionSide {
    Long,
    Short,
}

// Broker configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerConfig {
    pub broker_type: BrokerType,
    pub account_id: String,
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
    pub sandbox: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BrokerType {
    Mock,
    OANDA,
    InteractiveBrokers,
    Alpaca,
}