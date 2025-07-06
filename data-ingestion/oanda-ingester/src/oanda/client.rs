use anyhow::{Result, Context};
use eventsource_client::{self as sse, Client};
use futures::StreamExt;
use tracing::{info, error, debug};
use crate::config::OandaConfig;
use super::models::StreamingPriceEvent;

pub struct OandaClient {
    config: OandaConfig,
    client: reqwest::Client,
}

impl OandaClient {
    pub fn new(config: OandaConfig) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()?;

        Ok(Self { config, client })
    }

    pub async fn stream_prices<F>(&self, mut handler: F) -> Result<()>
    where
        F: FnMut(StreamingPriceEvent) + Send + 'static,
    {
        let instruments = self.config.streaming.instruments.join("%2C");
        let url = format!(
            "{}/v3/accounts/{}/pricing/stream?instruments={}",
            self.config.api_url, self.config.account_id, instruments
        );

        info!("Connecting to OANDA stream: {}", url);

        let client = sse::ClientBuilder::for_url(&url)?
            .header("Authorization", &format!("Bearer {}", self.config.api_token))?
            .header("Accept-Encoding", "gzip, deflate")?
            .build();

        let mut stream = Box::pin(client.stream());

        while let Some(event) = stream.next().await {
            match event {
                Ok(event) => {
                    match event {
                        sse::SSE::Event(e) => {
                            debug!("Received event: {:?}", e.event_type);
                            
                            match serde_json::from_str::<StreamingPriceEvent>(&e.data) {
                                Ok(price_event) => {
                                    handler(price_event);
                                }
                                Err(err) => {
                                    error!("Failed to parse event: {} - Data: {}", err, e.data);
                                }
                            }
                        }
                        sse::SSE::Comment(_) => {
                            // Ignore comments
                        }
                    }
                }
                Err(e) => {
                    error!("Stream error: {}", e);
                    return Err(anyhow::anyhow!("Stream error: {}", e));
                }
            }
        }

        Ok(())
    }

    pub async fn test_connection(&self) -> Result<()> {
        // Use the regular API endpoint for testing, not streaming
        let base_url = self.config.api_url.replace("stream-", "api-");
        let url = format!(
            "{}/v3/accounts/{}/pricing?instruments=EUR_USD",
            base_url, self.config.account_id
        );

        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_token))
            .send()
            .await
            .context("Failed to connect to OANDA")?;

        if response.status().is_success() {
            info!("Successfully connected to OANDA API");
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(anyhow::anyhow!("OANDA API error: {} - {}", status, body))
        }
    }
}