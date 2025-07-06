use anyhow::{Result, Context};
use pulsar::{
    producer::ProducerOptions, 
    compression::Compression,
    Pulsar, TokioExecutor,
};
use tracing::info;
use crate::config::PulsarConfig;
use crate::oanda::models::PulsarPriceMessage;

pub struct PriceProducer {
    pulsar: Pulsar<TokioExecutor>,
    config: PulsarConfig,
}

impl PriceProducer {
    pub async fn new(config: PulsarConfig) -> Result<Self> {
        info!("Connecting to Pulsar at {}", config.broker_url);
        
        let pulsar = Pulsar::builder(&config.broker_url, TokioExecutor)
            .build()
            .await
            .context("Failed to create Pulsar client")?;

        Ok(Self { pulsar, config })
    }

    pub async fn create_price_producer(&self, symbol: &str) -> Result<pulsar::Producer<TokioExecutor>> {
        let topic = format!("{}/{}", self.config.topics.prices, symbol.to_lowercase());
        
        let compression = match self.config.compression.as_str() {
            "lz4" => Compression::Lz4(pulsar::compression::CompressionLz4::default()),
            "zlib" => Compression::Zlib(pulsar::compression::CompressionZlib::default()),
            // "zstd" => Compression::Zstd(pulsar::compression::CompressionZstd::default()), // Not available in current version
            _ => Compression::None,
        };

        let producer = self.pulsar
            .producer()
            .with_topic(&topic)
            .with_name(format!("{}-{}", self.config.producer_name, symbol))
            .with_options(ProducerOptions {
                compression: Some(compression),
                ..Default::default()
            })
            .build()
            .await
            .context(format!("Failed to create producer for topic {}", topic))?;

        info!("Created producer for topic: {}", topic);
        Ok(producer)
    }

    pub async fn send_price(&self, producer: &mut pulsar::Producer<TokioExecutor>, message: PulsarPriceMessage) -> Result<()> {
        let payload = serde_json::to_vec(&message)?;
        
        producer
            .send_non_blocking(payload)
            .await
            .context("Failed to send price message")?
            .await
            .context("Failed to confirm price message")?;

        Ok(())
    }

    pub async fn send_heartbeat(&self, account: &str) -> Result<()> {
        let heartbeat = serde_json::json!({
            "type": "HEARTBEAT",
            "time": chrono::Utc::now(),
            "source": "oanda",
            "account": account,
        });

        let producer = self.pulsar
            .producer()
            .with_topic(&self.config.topics.heartbeat)
            .with_name(format!("{}-heartbeat", self.config.producer_name))
            .build()
            .await?;

        let mut producer = producer;
        let payload = serde_json::to_vec(&heartbeat)?;
        
        producer
            .send_non_blocking(payload)
            .await?
            .await?;

        Ok(())
    }

    pub async fn send_status(&self, status: &str, details: serde_json::Value) -> Result<()> {
        let status_msg = serde_json::json!({
            "type": "STATUS",
            "time": chrono::Utc::now(),
            "source": "oanda",
            "status": status,
            "details": details,
        });

        let producer = self.pulsar
            .producer()
            .with_topic(&self.config.topics.status)
            .with_name(format!("{}-status", self.config.producer_name))
            .build()
            .await?;

        let mut producer = producer;
        let payload = serde_json::to_vec(&status_msg)?;
        
        producer
            .send_non_blocking(payload)
            .await?
            .await?;

        Ok(())
    }
}