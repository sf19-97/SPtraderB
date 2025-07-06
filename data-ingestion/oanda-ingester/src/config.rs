use anyhow::Result;
use config::{Config as ConfigBuilder, ConfigError, File};
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Config {
    pub service: ServiceConfig,
    pub oanda: OandaConfig,
    pub pulsar: PulsarConfig,
    pub monitoring: MonitoringConfig,
    pub retry: RetryConfig,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ServiceConfig {
    pub name: String,
    pub environment: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OandaConfig {
    pub api_url: String,
    pub account_id: String,
    pub api_token: String,
    pub streaming: StreamingConfig,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StreamingConfig {
    pub instruments: Vec<String>,
    pub snapshot: bool,
    pub include_home_conversions: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PulsarConfig {
    pub broker_url: String,
    pub producer_name: String,
    pub compression: String,
    pub topics: TopicsConfig,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TopicsConfig {
    pub prices: String,
    pub heartbeat: String,
    pub status: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MonitoringConfig {
    pub health_check_port: u16,
    pub metrics_port: u16,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub initial_delay_ms: u64,
    pub max_delay_ms: u64,
    pub exponential_base: f64,
}

impl Config {
    pub fn load() -> Result<Self, ConfigError> {
        let mut builder = ConfigBuilder::builder()
            .add_source(File::with_name("config/default").required(false));

        // Add environment-specific config if specified
        if let Ok(env) = env::var("RUN_ENV") {
            builder = builder.add_source(File::with_name(&format!("config/{}", env)).required(false));
        }

        // Override with environment variables
        // OANDA credentials from environment
        if let Ok(account_id) = env::var("OANDA_ACCOUNT_ID") {
            builder = builder.set_override("oanda.account_id", account_id)?;
        }
        if let Ok(api_token) = env::var("OANDA_API_TOKEN") {
            builder = builder.set_override("oanda.api_token", api_token)?;
        }

        // Pulsar settings from environment
        if let Ok(broker_url) = env::var("PULSAR_BROKER_URL") {
            builder = builder.set_override("pulsar.broker_url", broker_url)?;
        }

        builder.build()?.try_deserialize()
    }
}