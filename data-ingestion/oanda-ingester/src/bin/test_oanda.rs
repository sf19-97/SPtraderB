use anyhow::Result;
use oanda_ingester::oanda::{OandaClient, models::StreamingPriceEvent};
use oanda_ingester::config::Config;
use tracing::{info, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    // Load .env file
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "oanda_ingester=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting OANDA connection test");

    // Load configuration
    let config = Config::load()?;
    
    // Check if credentials are set
    if config.oanda.account_id.is_empty() || config.oanda.api_token.is_empty() {
        error!("OANDA credentials not set! Please edit .env file with:");
        error!("  OANDA_ACCOUNT_ID=your-account-id");
        error!("  OANDA_API_TOKEN=your-api-token");
        return Err(anyhow::anyhow!("Missing OANDA credentials"));
    }

    info!("Account ID: {}", config.oanda.account_id);
    info!("API URL: {}", config.oanda.api_url);
    info!("Instruments: {:?}", config.oanda.streaming.instruments);

    // Create client
    let client = OandaClient::new(config.oanda)?;
    
    // Test connection first
    info!("Testing OANDA connection...");
    client.test_connection().await?;
    info!("✓ Successfully connected to OANDA API");

    // Stream prices for 30 seconds
    info!("Starting price stream (will run for 30 seconds)...");
    
    let start = std::time::Instant::now();
    let mut price_count = 0;
    
    tokio::select! {
        result = client.stream_prices(move |event| {
            match event {
                StreamingPriceEvent::Price(price) => {
                    price_count += 1;
                    info!("#{} {} - Bid: {:?}, Ask: {:?}", 
                        price_count,
                        price.instrument,
                        price.bid.as_ref().map(|b| &b.price),
                        price.ask.as_ref().map(|a| &a.price)
                    );
                }
                StreamingPriceEvent::Heartbeat(hb) => {
                    info!("♥ Heartbeat: {}", hb.time);
                }
            }
        }) => {
            if let Err(e) = result {
                error!("Stream error: {}", e);
            }
        }
        _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {
            info!("Test duration reached");
        }
    }

    let elapsed = start.elapsed();
    info!("Test completed in {:.1}s", elapsed.as_secs_f64());
    info!("Received {} price updates", price_count);

    Ok(())
}