use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, error, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod oanda;
mod pulsar;

use config::Config;
use oanda::OandaClient;
use pulsar::PriceProducer;

#[tokio::main]
async fn main() -> Result<()> {
    // Load .env file if it exists
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "oanda_ingester=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting OANDA Ingester Service");

    // Load configuration
    let config = Config::load()?;
    info!("Configuration loaded: {:?}", config.service.name);
    info!("Monitoring instruments: {:?}", config.oanda.streaming.instruments);

    // Initialize Pulsar producer
    info!("Initializing Pulsar connection...");
    let price_producer = Arc::new(PriceProducer::new(config.pulsar.clone()).await?);
    
    // Create producers for each instrument
    let producers = Arc::new(Mutex::new(HashMap::new()));
    for instrument in &config.oanda.streaming.instruments {
        let producer = price_producer.create_price_producer(instrument).await?;
        producers.lock().await.insert(instrument.clone(), producer);
    }

    // Initialize OANDA client
    info!("Initializing OANDA client...");
    let oanda_client = OandaClient::new(config.oanda.clone())?;
    
    // Test connection
    oanda_client.test_connection().await?;
    info!("Successfully connected to OANDA API");

    // Send initial status
    price_producer.send_status("connected", serde_json::json!({
        "instruments": config.oanda.streaming.instruments,
        "account": config.oanda.account_id,
    })).await?;

    // Clone for the streaming task
    let price_producer_clone = price_producer.clone();
    let producers_clone = producers.clone();
    let account_id = config.oanda.account_id.clone();

    // Start streaming prices
    let streaming_task = tokio::spawn(async move {
        let result = oanda_client.stream_prices(move |event| {
            let producer = price_producer_clone.clone();
            let producers = producers_clone.clone();
            let account = account_id.clone();
            
            tokio::spawn(async move {
                match event {
                    oanda::models::StreamingPriceEvent::Price(price_event) => {
                        info!("Price update: {} - Bid: {:?}, Ask: {:?}", 
                            price_event.instrument,
                            price_event.bid.as_ref().map(|b| &b.price),
                            price_event.ask.as_ref().map(|a| &a.price)
                        );
                        
                        // Convert to Pulsar message
                        let mut message: oanda::models::PulsarPriceMessage = price_event.clone().into();
                        message.account = account;
                        
                        // Send to appropriate topic
                        let mut producers_guard = producers.lock().await;
                        if let Some(prod) = producers_guard.get_mut(&price_event.instrument) {
                            if let Err(e) = producer.send_price(prod, message).await {
                                error!("Failed to send price to Pulsar: {}", e);
                            }
                        }
                    }
                    oanda::models::StreamingPriceEvent::Heartbeat(heartbeat) => {
                        info!("Heartbeat: {}", heartbeat.time);
                        if let Err(e) = producer.send_heartbeat(&account).await {
                            error!("Failed to send heartbeat: {}", e);
                        }
                    }
                }
            });
        }).await;

        if let Err(e) = result {
            error!("Streaming error: {}", e);
        }
    });

    // TODO: Start health check server

    // Handle shutdown
    tokio::select! {
        _ = streaming_task => {
            warn!("Streaming task ended unexpectedly");
        }
        _ = tokio::signal::ctrl_c() => {
            info!("Received shutdown signal");
        }
    }

    // Send disconnection status
    price_producer.send_status("disconnected", serde_json::json!({
        "reason": "shutdown",
    })).await?;

    info!("OANDA Ingester Service stopped");
    Ok(())
}
