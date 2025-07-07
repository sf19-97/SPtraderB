use anyhow::Result;
use reqwest;
use serde_json::Value;
use dotenvy;

#[tokio::main]
async fn main() -> Result<()> {
    // Load .env file
    dotenvy::dotenv().ok();

    let account_id = std::env::var("OANDA_ACCOUNT_ID")?;
    let api_token = std::env::var("OANDA_API_TOKEN")?;

    println!("Testing OANDA API...\n");

    // Test 1: Get account details
    let client = reqwest::Client::new();
    let account_url = format!("https://api-fxpractice.oanda.com/v3/accounts/{}", account_id);
    
    let response = client
        .get(&account_url)
        .header("Authorization", format!("Bearer {}", api_token))
        .send()
        .await?;

    if response.status().is_success() {
        let data: Value = response.json().await?;
        println!("✓ Account connected successfully!");
        println!("  Balance: {} {}", 
            data["account"]["balance"].as_str().unwrap_or("N/A"),
            data["account"]["currency"].as_str().unwrap_or("N/A")
        );
    }

    // Test 2: Get available instruments
    println!("\n📊 Available instruments:");
    let instruments_url = format!("https://api-fxpractice.oanda.com/v3/accounts/{}/instruments", account_id);
    
    let response = client
        .get(&instruments_url)
        .header("Authorization", format!("Bearer {}", api_token))
        .send()
        .await?;

    if response.status().is_success() {
        let data: Value = response.json().await?;
        let instruments = data["instruments"].as_array().unwrap();
        
        // Show crypto and major forex pairs
        for inst in instruments {
            let name = inst["name"].as_str().unwrap();
            let display = inst["displayName"].as_str().unwrap();
            
            if name.contains("BTC") || name.contains("ETH") || 
               name == "EUR_USD" || name == "GBP_USD" || name == "USD_JPY" {
                println!("  {} - {}", name, display);
            }
        }
    }

    // Test 3: Get current prices for tradeable instruments
    println!("\n💹 Testing price feed (showing first few prices):");
    let prices_url = format!(
        "https://api-fxpractice.oanda.com/v3/accounts/{}/pricing?instruments=EUR_USD,GBP_USD", 
        account_id
    );
    
    let response = client
        .get(&prices_url)
        .header("Authorization", format!("Bearer {}", api_token))
        .send()
        .await?;

    if response.status().is_success() {
        let data: Value = response.json().await?;
        let prices = data["prices"].as_array().unwrap();
        
        for price in prices {
            let instrument = price["instrument"].as_str().unwrap();
            let bid = price["bids"][0]["price"].as_str().unwrap_or("N/A");
            let ask = price["asks"][0]["price"].as_str().unwrap_or("N/A");
            let tradeable = price["tradeable"].as_bool().unwrap_or(false);
            
            println!("  {} - Bid: {}, Ask: {}, Tradeable: {}", 
                instrument, bid, ask, 
                if tradeable { "✓" } else { "✗ (Market Closed)" }
            );
        }
    }

    println!("\n📅 Note: Forex markets are closed from Friday 21:00 UTC to Sunday 21:00 UTC");
    println!("   Current time: {} UTC", chrono::Utc::now().format("%Y-%m-%d %H:%M:%S"));

    Ok(())
}