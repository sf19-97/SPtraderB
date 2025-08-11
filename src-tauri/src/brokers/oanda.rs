use async_trait::async_trait;
use chrono::Utc;
use log::{error, info, debug};
use reqwest::{Client, header};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde::Deserialize;
use std::time::Duration;

use crate::brokers::{AccountInfo, BrokerAPI, BrokerOrderResponse, Position, PositionSide};
use crate::orders::{Order, OrderSide, OrderStatus, OrderType};

pub struct OandaBroker {
    api_url: String,
    account_id: String,
    api_token: String,
    client: Client,
    connected: bool,
}

#[derive(Debug, Clone)]
pub struct OandaConfig {
    pub api_url: String,
    pub account_id: String,
    pub api_token: String,
    pub practice: bool,
}

impl OandaBroker {
    pub fn new(config: OandaConfig) -> Self {
        let mut headers = header::HeaderMap::new();
        let auth_header = format!("Bearer {}", config.api_token);
        debug!("Creating Authorization header with token length: {}", config.api_token.len());
        debug!("First 8 chars of token: {}...", &config.api_token.chars().take(8).collect::<String>());
        
        headers.insert(
            header::AUTHORIZATION,
            header::HeaderValue::from_str(&auth_header).unwrap(),
        );
        headers.insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );

        let client = Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            api_url: config.api_url,
            account_id: config.account_id,
            api_token: config.api_token,
            client,
            connected: false,
        }
    }

    fn get_oanda_instrument(&self, symbol: &str) -> String {
        // Convert our symbol format to OANDA format
        symbol.replace("/", "_")
    }

    async fn check_account(&self) -> Result<(), String> {
        let url = format!("{}/v3/accounts/{}", self.api_url, self.account_id);
        
        debug!("Checking OANDA account at URL: {}", url);
        debug!("Account ID: {}", self.account_id);
        
        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to connect to OANDA: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!("OANDA API error {}: {}", status, error_text);
            return Err(format!("OANDA API error {}: {}", status, error_text));
        }

        Ok(())
    }

    fn convert_order_type(&self, order_type: &OrderType) -> Result<OandaOrderRequest, String> {
        match order_type {
            OrderType::Market => Ok(OandaOrderRequest {
                order_type: "MARKET".to_string(),
                price: None,
                price_bound: None,
                stop_loss: None,
                take_profit: None,
                trailing_stop_loss: None,
            }),
            OrderType::Limit { price } => Ok(OandaOrderRequest {
                order_type: "LIMIT".to_string(),
                price: Some(price.to_string()),
                price_bound: None,
                stop_loss: None,
                take_profit: None,
                trailing_stop_loss: None,
            }),
            OrderType::Stop { stop_price } => Ok(OandaOrderRequest {
                order_type: "STOP".to_string(),
                price: Some(stop_price.to_string()),
                price_bound: None,
                stop_loss: None,
                take_profit: None,
                trailing_stop_loss: None,
            }),
            _ => Err("Unsupported order type for OANDA".to_string()),
        }
    }
}

#[async_trait]
impl BrokerAPI for OandaBroker {
    async fn connect(&mut self) -> Result<(), String> {
        info!("Connecting to OANDA API...");
        
        match self.check_account().await {
            Ok(_) => {
                self.connected = true;
                info!("Successfully connected to OANDA");
                Ok(())
            }
            Err(e) => {
                error!("Failed to connect to OANDA: {}", e);
                Err(e)
            }
        }
    }

    async fn disconnect(&mut self) -> Result<(), String> {
        self.connected = false;
        info!("Disconnected from OANDA");
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    async fn ping(&self) -> Result<Duration, String> {
        let start = std::time::Instant::now();
        self.check_account().await?;
        Ok(start.elapsed())
    }

    async fn submit_order(&self, order: &Order) -> Result<BrokerOrderResponse, String> {
        if !self.connected {
            return Err("Not connected to OANDA".to_string());
        }

        let oanda_order = self.convert_order_type(&order.order_type)?;
        let instrument = self.get_oanda_instrument(&order.symbol);
        
        // Build order request
        let units = match order.side {
            OrderSide::Buy => order.quantity.to_i32().unwrap(),
            OrderSide::Sell => -order.quantity.to_i32().unwrap(),
        };

        let request_body = serde_json::json!({
            "order": {
                "units": units.to_string(),
                "instrument": instrument,
                "timeInForce": "FOK",
                "type": oanda_order.order_type,
                "positionFill": "DEFAULT"
            }
        });

        debug!("Submitting order to OANDA: {:?}", request_body);

        let url = format!("{}/v3/accounts/{}/orders", self.api_url, self.account_id);
        let response = self.client
            .post(&url)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to submit order: {}", e))?;

        let status_code = response.status();
        let response_text = response.text().await.unwrap_or_default();

        if !status_code.is_success() {
            error!("OANDA order submission failed: {} - {}", status_code, response_text);
            return Err(format!("Order submission failed: {}", response_text));
        }

        // Parse response
        let oanda_response: OandaOrderResponse = serde_json::from_str(&response_text)
            .map_err(|e| format!("Failed to parse OANDA response: {} - Response: {}", e, response_text))?;

        info!("OANDA order submitted successfully: {}", oanda_response.order_create_transaction.id);

        Ok(BrokerOrderResponse {
            broker_order_id: oanda_response.order_create_transaction.id,
            status: if oanda_response.order_fill_transaction.is_some() {
                OrderStatus::Filled
            } else {
                OrderStatus::Submitted
            },
            accepted_at: Utc::now(),
            message: Some("Order submitted to OANDA".to_string()),
        })
    }

    async fn cancel_order(&self, order_id: &str) -> Result<(), String> {
        if !self.connected {
            return Err("Not connected to OANDA".to_string());
        }

        let url = format!("{}/v3/accounts/{}/orders/{}/cancel", 
            self.api_url, self.account_id, order_id);

        let response = self.client
            .put(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to cancel order: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Failed to cancel order: {}", error_text));
        }

        Ok(())
    }

    async fn get_order_status(&self, order_id: &str) -> Result<OrderStatus, String> {
        if !self.connected {
            return Err("Not connected to OANDA".to_string());
        }

        let url = format!("{}/v3/accounts/{}/orders/{}", 
            self.api_url, self.account_id, order_id);

        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to get order status: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Failed to get order status: {}", error_text));
        }

        let order_info: OandaOrderInfo = response.json().await
            .map_err(|e| format!("Failed to parse order info: {}", e))?;

        Ok(match order_info.order.state.as_str() {
            "PENDING" => OrderStatus::PendingSubmit,
            "FILLED" => OrderStatus::Filled,
            "CANCELLED" => OrderStatus::Cancelled,
            _ => OrderStatus::Submitted,
        })
    }

    async fn get_account_info(&self) -> Result<AccountInfo, String> {
        if !self.connected {
            return Err("Not connected to OANDA".to_string());
        }

        let url = format!("{}/v3/accounts/{}", self.api_url, self.account_id);
        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to get account info: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Failed to get account info: {}", error_text));
        }

        let account: OandaAccount = response.json().await
            .map_err(|e| format!("Failed to parse account info: {}", e))?;

        Ok(AccountInfo {
            account_id: account.account.id,
            balance: Decimal::from_str_exact(&account.account.balance).unwrap_or_default(),
            buying_power: Decimal::from_str_exact(&account.account.margin_available).unwrap_or_default(),
            currency: account.account.currency,
            margin_used: Decimal::from_str_exact(&account.account.margin_used).unwrap_or_default(),
            margin_available: Decimal::from_str_exact(&account.account.margin_available).unwrap_or_default(),
        })
    }

    async fn get_positions(&self) -> Result<Vec<Position>, String> {
        if !self.connected {
            return Err("Not connected to OANDA".to_string());
        }

        let url = format!("{}/v3/accounts/{}/positions", self.api_url, self.account_id);
        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to get positions: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Failed to get positions: {}", error_text));
        }

        let positions_response: OandaPositions = response.json().await
            .map_err(|e| format!("Failed to parse positions: {}", e))?;

        let mut positions = Vec::new();
        for pos in positions_response.positions {
            let long_units = Decimal::from_str_exact(&pos.long.units).unwrap_or_default();
            let short_units = Decimal::from_str_exact(&pos.short.units).unwrap_or_default();
            
            if long_units > Decimal::ZERO {
                positions.push(Position {
                    symbol: pos.instrument.replace("_", "/"),
                    side: PositionSide::Long,
                    quantity: long_units,
                    average_price: Decimal::from_str_exact(&pos.long.average_price).unwrap_or_default(),
                    current_price: None,
                    unrealized_pnl: Some(Decimal::from_str_exact(&pos.long.unrealized_pl).unwrap_or_default()),
                    realized_pnl: Decimal::from_str_exact(&pos.long.pl).unwrap_or_default(),
                });
            }
            
            if short_units < Decimal::ZERO {
                positions.push(Position {
                    symbol: pos.instrument.replace("_", "/"),
                    side: PositionSide::Short,
                    quantity: short_units.abs(),
                    average_price: Decimal::from_str_exact(&pos.short.average_price).unwrap_or_default(),
                    current_price: None,
                    unrealized_pnl: Some(Decimal::from_str_exact(&pos.short.unrealized_pl).unwrap_or_default()),
                    realized_pnl: Decimal::from_str_exact(&pos.short.pl).unwrap_or_default(),
                });
            }
        }

        Ok(positions)
    }
}

// OANDA API response structures
#[derive(Debug, Deserialize)]
struct OandaOrderRequest {
    #[serde(rename = "type")]
    order_type: String,
    price: Option<String>,
    #[serde(rename = "priceBound")]
    price_bound: Option<String>,
    #[serde(rename = "stopLoss")]
    stop_loss: Option<String>,
    #[serde(rename = "takeProfit")]
    take_profit: Option<String>,
    #[serde(rename = "trailingStopLoss")]
    trailing_stop_loss: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OandaOrderResponse {
    #[serde(rename = "orderCreateTransaction")]
    order_create_transaction: OandaTransaction,
    #[serde(rename = "orderFillTransaction")]
    order_fill_transaction: Option<OandaTransaction>,
}

#[derive(Debug, Deserialize)]
struct OandaTransaction {
    id: String,
    time: String,
    #[serde(rename = "type")]
    transaction_type: String,
}

#[derive(Debug, Deserialize)]
struct OandaOrderInfo {
    order: OandaOrderDetails,
}

#[derive(Debug, Deserialize)]
struct OandaOrderDetails {
    id: String,
    state: String,
    instrument: String,
    units: String,
    price: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OandaAccount {
    account: OandaAccountDetails,
}

#[derive(Debug, Deserialize)]
struct OandaAccountDetails {
    id: String,
    currency: String,
    balance: String,
    #[serde(rename = "marginAvailable")]
    margin_available: String,
    #[serde(rename = "marginUsed")]
    margin_used: String,
}

#[derive(Debug, Deserialize)]
struct OandaPositions {
    positions: Vec<OandaPosition>,
}

#[derive(Debug, Deserialize)]
struct OandaPosition {
    instrument: String,
    long: OandaPositionSide,
    short: OandaPositionSide,
}

#[derive(Debug, Deserialize)]
struct OandaPositionSide {
    units: String,
    #[serde(rename = "averagePrice")]
    average_price: String,
    pl: String,
    #[serde(rename = "unrealizedPL")]
    unrealized_pl: String,
}