use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use pulsar::{
    producer::ProducerOptions,
    compression::Compression,
    Pulsar, TokioExecutor,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{error, info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum KrakenMessage {
    Event(KrakenEvent),
    ChannelData(Vec<serde_json::Value>),
}

#[derive(Debug, Deserialize)]
struct KrakenEvent {
    event: String,
    #[serde(flatten)]
    data: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct PulsarMessage {
    #[serde(rename = "type")]
    msg_type: String,
    symbol: String,
    exchange: String,
    timestamp: chrono::DateTime<chrono::Utc>,
    data: serde_json::Value,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kraken_ingester=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting Kraken WebSocket Ingester");

    // Connect to Pulsar
    let pulsar_url = std::env::var("PULSAR_URL").unwrap_or_else(|_| "pulsar://localhost:6650".to_string());
    info!("Connecting to Pulsar at {}", pulsar_url);
    
    let pulsar: Pulsar<TokioExecutor> = Pulsar::builder(&pulsar_url, TokioExecutor)
        .build()
        .await?;

    // Create producers for different data types
    let ticker_producer = pulsar
        .producer()
        .with_topic("persistent://public/default/market-data/crypto/raw/kraken/btcusd/ticker")
        .with_name("kraken-ticker-producer")
        .with_options(ProducerOptions {
            compression: Some(Compression::Lz4(pulsar::compression::CompressionLz4::default())),
            ..Default::default()
        })
        .build()
        .await?;

    let trades_producer = pulsar
        .producer()
        .with_topic("persistent://public/default/market-data/crypto/raw/kraken/btcusd/trades")
        .with_name("kraken-trades-producer")
        .with_options(ProducerOptions {
            compression: Some(Compression::Lz4(pulsar::compression::CompressionLz4::default())),
            ..Default::default()
        })
        .build()
        .await?;

    let spread_producer = pulsar
        .producer()
        .with_topic("persistent://public/default/market-data/crypto/raw/kraken/btcusd/spread")
        .with_name("kraken-spread-producer")
        .with_options(ProducerOptions {
            compression: Some(Compression::Lz4(pulsar::compression::CompressionLz4::default())),
            ..Default::default()
        })
        .build()
        .await?;

    info!("Connected to Pulsar, created producers");

    // Connect to Kraken WebSocket
    let url = "wss://ws.kraken.com";
    info!("Connecting to Kraken WebSocket at {}", url);

    let (ws_stream, _) = connect_async(url).await?;
    info!("Connected to Kraken WebSocket");

    let (mut write, mut read) = ws_stream.split();

    // Subscribe to BTC/USD ticker, trades, and spread
    let subscribe_msg = json!({
        "event": "subscribe",
        "pair": ["XBT/USD"],
        "subscription": {
            "name": "ticker"
        }
    });

    write.send(Message::Text(subscribe_msg.to_string())).await?;

    // Also subscribe to trades
    let trades_sub = json!({
        "event": "subscribe",
        "pair": ["XBT/USD"],
        "subscription": {
            "name": "trade"
        }
    });
    write.send(Message::Text(trades_sub.to_string())).await?;

    // And spread
    let spread_sub = json!({
        "event": "subscribe",
        "pair": ["XBT/USD"],
        "subscription": {
            "name": "spread"
        }
    });
    write.send(Message::Text(spread_sub.to_string())).await?;

    info!("Subscribed to BTC/USD ticker, trades, and spread");

    // Clone producers for the async move block
    let mut ticker_prod = ticker_producer;
    let mut trades_prod = trades_producer;
    let mut spread_prod = spread_producer;

    // Main message loop
    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                match serde_json::from_str::<KrakenMessage>(&text) {
                    Ok(KrakenMessage::Event(event)) => {
                        info!("Kraken event: {} - {:?}", event.event, event.data);
                    }
                    Ok(KrakenMessage::ChannelData(data)) => {
                        if data.len() >= 3 {
                            // Format: [channelID, data, channel_name, pair]
                            let channel_name = data.get(data.len() - 2)
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            
                            let pair = data.get(data.len() - 1)
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");

                            match channel_name {
                                "ticker" => {
                                    if let Some(ticker_data) = data.get(1) {
                                        info!("📊 Ticker {} - {}", pair, ticker_data);
                                        
                                        // Send to Pulsar
                                        let msg = PulsarMessage {
                                            msg_type: "ticker".to_string(),
                                            symbol: pair.to_string(),
                                            exchange: "kraken".to_string(),
                                            timestamp: chrono::Utc::now(),
                                            data: ticker_data.clone(),
                                        };
                                        
                                        let payload = serde_json::to_vec(&msg)?;
                                        ticker_prod.send_non_blocking(payload).await?.await?;
                                    }
                                }
                                "trade" => {
                                    if let Some(trades) = data.get(1).and_then(|v| v.as_array()) {
                                        for trade in trades {
                                            info!("💹 Trade {} - {}", pair, trade);
                                            
                                            // Send to Pulsar
                                            let msg = PulsarMessage {
                                                msg_type: "trade".to_string(),
                                                symbol: pair.to_string(),
                                                exchange: "kraken".to_string(),
                                                timestamp: chrono::Utc::now(),
                                                data: trade.clone(),
                                            };
                                            
                                            let payload = serde_json::to_vec(&msg)?;
                                            trades_prod.send_non_blocking(payload).await?.await?;
                                        }
                                    }
                                }
                                "spread" => {
                                    if let Some(spread_data) = data.get(1) {
                                        info!("📈 Spread {} - {}", pair, spread_data);
                                        
                                        // Send to Pulsar
                                        let msg = PulsarMessage {
                                            msg_type: "spread".to_string(),
                                            symbol: pair.to_string(),
                                            exchange: "kraken".to_string(),
                                            timestamp: chrono::Utc::now(),
                                            data: spread_data.clone(),
                                        };
                                        
                                        let payload = serde_json::to_vec(&msg)?;
                                        spread_prod.send_non_blocking(payload).await?.await?;
                                    }
                                }
                                _ => {
                                    warn!("Unknown channel: {}", channel_name);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to parse message: {} - Raw: {}", e, text);
                    }
                }
            }
            Ok(Message::Close(_)) => {
                info!("WebSocket closed");
                break;
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    info!("Kraken ingester stopped");
    Ok(())
}
