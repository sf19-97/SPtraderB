use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use std::fs;
use std::path::PathBuf;
use crate::candles::MarketCandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartSession {
    pub symbol: String,
    pub timeframe: String,
    pub candles: Vec<MarketCandle>,
    pub visible_range: VisibleRange,
    pub bar_spacing: f64,
    pub saved_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisibleRange {
    pub from: i64,
    pub to: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFile {
    pub version: u32,
    pub session: ChartSession,
}

impl ChartSession {
    pub fn new(
        symbol: String,
        timeframe: String,
        candles: Vec<MarketCandle>,
        visible_range: VisibleRange,
        bar_spacing: f64,
    ) -> Self {
        Self {
            symbol,
            timeframe,
            candles,
            visible_range,
            bar_spacing,
            saved_at: Utc::now(),
        }
    }
}

pub fn get_session_file_path() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("sptraderb");
    
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    
    Ok(config_dir.join("last_chart_session.json"))
}

pub async fn save_chart_session(session: ChartSession) -> Result<(), String> {
    let file_path = get_session_file_path()?;
    
    let session_file = SessionFile {
        version: 1,
        session,
    };
    
    let json = serde_json::to_string_pretty(&session_file)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;
    
    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write session file: {}", e))?;
    
    Ok(())
}

pub async fn load_last_session() -> Result<Option<ChartSession>, String> {
    let file_path = get_session_file_path()?;
    
    if !file_path.exists() {
        return Ok(None);
    }
    
    let contents = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read session file: {}", e))?;
    
    let session_file: SessionFile = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse session file: {}", e))?;
    
    // Check if session is too old (24 hours)
    let age = Utc::now() - session_file.session.saved_at;
    if age.num_hours() > 24 {
        return Ok(None);
    }
    
    Ok(Some(session_file.session))
}

pub async fn clear_session() -> Result<(), String> {
    let file_path = get_session_file_path()?;
    
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to remove session file: {}", e))?;
    }
    
    Ok(())
}