use crate::brokers::BrokerAPI;
use crate::orders::{Order, OrderEvent, OrderEventType, validate_order};
use log::{error, info, warn};
use redis::aio::Connection;
use redis::streams::{StreamReadOptions, StreamReadReply};
use redis::{AsyncCommands, Client as RedisClient};
use serde_json;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

pub struct ExecutionEngine {
    redis_client: RedisClient,
    broker: Arc<RwLock<Box<dyn BrokerAPI>>>,
}

impl ExecutionEngine {
    pub fn new(redis_url: &str, broker: Box<dyn BrokerAPI>) -> Result<Self, String> {
        let redis_client = RedisClient::open(redis_url)
            .map_err(|e| format!("Failed to create Redis client: {}", e))?;

        Ok(Self {
            redis_client,
            broker: Arc::new(RwLock::new(broker)),
        })
    }

    pub async fn submit_order(&self, order: Order) -> Result<String, String> {
        // Validate order
        validate_order(&order)?;

        // Serialize order
        let order_json = serde_json::to_string(&order)
            .map_err(|e| format!("Failed to serialize order: {}", e))?;

        // Get Redis connection
        let mut conn = self.redis_client
            .get_async_connection()
            .await
            .map_err(|e| format!("Failed to get Redis connection: {}", e))?;

        // Add to pending queue
        let _: String = conn
            .xadd(
                "orders:pending",
                "*",
                &[
                    ("order", order_json.as_str()),
                    ("order_id", &order.id.to_string()),
                    ("timestamp", &chrono::Utc::now().to_rfc3339()),
                ],
            )
            .await
            .map_err(|e| format!("Failed to add order to queue: {}", e))?;

        // Log event
        self.log_order_event(&mut conn, &order, OrderEventType::Submitted, HashMap::new())
            .await?;

        info!("Order {} submitted to execution queue", order.id);
        Ok(order.id.to_string())
    }

    pub async fn run(&self) -> Result<(), String> {
        info!("Starting execution engine");

        let mut conn = self.redis_client
            .get_async_connection()
            .await
            .map_err(|e| format!("Failed to get Redis connection: {}", e))?;

        // Create consumer group if it doesn't exist
        let _: Result<(), _> = conn
            .xgroup_create_mkstream("orders:pending", "execution_group", "$")
            .await;

        loop {
            // Read from stream
            let options = StreamReadOptions::default()
                .group("execution_group", "executor-1")
                .count(1)
                .block(1000);

            let reply: StreamReadReply = conn
                .xread_options(&["orders:pending"], &[">"], &options)
                .await
                .map_err(|e| format!("Failed to read from stream: {}", e))?;

            for stream_key in reply.keys {
                for stream_id in stream_key.ids {
                    // Process each order
                    if let Some(order_data) = stream_id.map.get("order") {
                        match order_data {
                            redis::Value::Data(data) => {
                                if let Ok(order_json) = String::from_utf8(data.clone()) {
                                match self.process_order(&order_json).await {
                                    Ok(_) => {
                                        // Acknowledge message
                                        let _: () = conn
                                            .xack("orders:pending", "execution_group", &[&stream_id.id])
                                            .await
                                            .unwrap_or(());
                                    }
                                    Err(e) => {
                                        error!("Failed to process order: {}", e);
                                    }
                                }
                                }
                            }
                            _ => {
                                warn!("Invalid order data in stream");
                            }
                        }
                    }
                }
            }
        }
    }

    async fn process_order(&self, order_json: &str) -> Result<(), String> {
        // Parse order
        let mut order: Order = serde_json::from_str(order_json)
            .map_err(|e| format!("Failed to parse order: {}", e))?;

        info!("Processing order {}", order.id);

        // Get broker
        let broker = self.broker.read().await;

        // Check if connected
        if !broker.is_connected() {
            return Err("Broker not connected".to_string());
        }

        // Submit to broker
        match broker.submit_order(&order).await {
            Ok(response) => {
                order.broker_order_id = Some(response.broker_order_id.clone());
                order.status = response.status;

                // Log success event
                let mut conn = self.redis_client.get_async_connection().await.unwrap();
                self.log_order_event(
                    &mut conn,
                    &order,
                    OrderEventType::Acknowledged,
                    HashMap::from([
                        ("broker_order_id".to_string(), serde_json::Value::String(response.broker_order_id)),
                        ("message".to_string(), serde_json::Value::String(response.message.unwrap_or_default())),
                    ]),
                )
                .await?;

                info!("Order {} submitted to broker", order.id);
                Ok(())
            }
            Err(e) => {
                error!("Failed to submit order to broker: {}", e);
                
                // Log failure event
                let mut conn = self.redis_client.get_async_connection().await.unwrap();
                self.log_order_event(
                    &mut conn,
                    &order,
                    OrderEventType::Rejected,
                    HashMap::from([("reason".to_string(), serde_json::Value::String(e.clone()))]),
                )
                .await?;

                Err(e)
            }
        }
    }

    async fn log_order_event(
        &self,
        conn: &mut Connection,
        order: &Order,
        event_type: OrderEventType,
        details: HashMap<String, serde_json::Value>,
    ) -> Result<(), String> {
        let event = OrderEvent {
            id: Uuid::new_v4(),
            order_id: order.id,
            event_type: event_type.clone(),
            timestamp: chrono::Utc::now(),
            details,
        };

        let event_json = serde_json::to_string(&event)
            .map_err(|e| format!("Failed to serialize event: {}", e))?;

        let _: String = conn
            .xadd(
                "orders:events",
                "*",
                &[
                    ("event", event_json.as_str()),
                    ("order_id", &order.id.to_string()),
                    ("event_type", &format!("{:?}", event_type)),
                ],
            )
            .await
            .map_err(|e| format!("Failed to log event: {}", e))?;

        Ok(())
    }
}

// Order queue status for monitoring
#[derive(Debug, Clone, serde::Serialize)]
pub struct QueueStatus {
    pub pending_orders: usize,
    pub processing_orders: usize,
    pub completed_orders: usize,
    pub failed_orders: usize,
}

pub async fn get_queue_status(redis_client: &RedisClient) -> Result<QueueStatus, String> {
    let mut conn = redis_client
        .get_async_connection()
        .await
        .map_err(|e| format!("Failed to get Redis connection: {}", e))?;

    let pending: usize = conn
        .xlen("orders:pending")
        .await
        .unwrap_or(0);

    let completed: usize = conn
        .xlen("orders:completed")
        .await
        .unwrap_or(0);

    let failed: usize = conn
        .xlen("orders:failed")
        .await
        .unwrap_or(0);

    Ok(QueueStatus {
        pending_orders: pending,
        processing_orders: 0, // Would need to track this separately
        completed_orders: completed,
        failed_orders: failed,
    })
}