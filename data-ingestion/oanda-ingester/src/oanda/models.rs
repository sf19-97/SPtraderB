use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StreamingPriceEvent {
    #[serde(rename = "PRICE")]
    Price(PriceEvent),
    #[serde(rename = "HEARTBEAT")]
    Heartbeat(HeartbeatEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceEvent {
    pub instrument: String,
    pub time: DateTime<Utc>,
    pub bid: Option<PriceQuote>,
    pub ask: Option<PriceQuote>,
    #[serde(rename = "closeoutBid")]
    pub closeout_bid: Option<String>,
    #[serde(rename = "closeoutAsk")]
    pub closeout_ask: Option<String>,
    pub status: String,
    pub tradeable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceQuote {
    pub price: String,
    pub liquidity: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatEvent {
    pub time: DateTime<Utc>,
}

// Message format for Pulsar
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PulsarPriceMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub instrument: String,
    pub time: DateTime<Utc>,
    pub bid: Option<BidAsk>,
    pub ask: Option<BidAsk>,
    pub closeout_bid: Option<String>,
    pub closeout_ask: Option<String>,
    pub status: String,
    pub source: String,
    pub account: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidAsk {
    pub price: String,
    pub liquidity: i64,
}

impl From<PriceEvent> for PulsarPriceMessage {
    fn from(event: PriceEvent) -> Self {
        PulsarPriceMessage {
            message_type: "PRICE".to_string(),
            instrument: event.instrument,
            time: event.time,
            bid: event.bid.map(|b| BidAsk {
                price: b.price,
                liquidity: b.liquidity.unwrap_or(0),
            }),
            ask: event.ask.map(|a| BidAsk {
                price: a.price,
                liquidity: a.liquidity.unwrap_or(0),
            }),
            closeout_bid: event.closeout_bid,
            closeout_ask: event.closeout_ask,
            status: event.status,
            source: "oanda".to_string(),
            account: "".to_string(), // Will be filled by the client
        }
    }
}