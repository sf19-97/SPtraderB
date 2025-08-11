#!/usr/bin/env python3
"""
OANDA v20 API Information

This script documents OANDA's data structure and update frequency based on their v20 API.

OANDA v20 API Key Information:
1. Tick Data Structure
2. Update Frequency
3. Data Storage Considerations
"""

# OANDA v20 API Documentation Summary

print("OANDA v20 API - Data Structure and Update Frequency")
print("=" * 60)

print("\n1. TICK DATA STRUCTURE:")
print("-" * 40)
print("OANDA provides tick data through their v20 Streaming API")
print("Each tick contains:")
print("  - time: RFC3339 timestamp")
print("  - bid: Current bid price")
print("  - ask: Current ask price")
print("  - instrument: Currency pair (e.g., 'EUR_USD')")
print("\nExample tick structure:")
print("""
{
  "type": "PRICE",
  "time": "2024-01-15T10:30:45.123456789Z",
  "bids": [{"price": "1.08765", "liquidity": 10000000}],
  "asks": [{"price": "1.08767", "liquidity": 10000000}],
  "closeoutBid": "1.08765",
  "closeoutAsk": "1.08767",
  "status": "tradeable",
  "tradeable": true,
  "instrument": "EUR_USD"
}
""")

print("\n2. UPDATE FREQUENCY:")
print("-" * 40)
print("OANDA streams tick data in real-time with the following characteristics:")
print("  - Updates: Variable frequency (market-dependent)")
print("  - Active markets: Multiple updates per second")
print("  - Quiet markets: Updates every few seconds")
print("  - Weekend: No updates (market closed)")
print("  - Typical rate: 1-5 ticks per second during active hours")

print("\n3. STREAMING ENDPOINTS:")
print("-" * 40)
print("Price Streaming:")
print("  GET /v3/accounts/{accountID}/pricing/stream")
print("  - Real-time bid/ask prices")
print("  - Heartbeat every 5 seconds")
print("  - Multiple instruments supported")

print("\n4. CANDLE/HISTORICAL DATA:")
print("-" * 40)
print("Candles Endpoint:")
print("  GET /v3/instruments/{instrument}/candles")
print("  - Granularities: S5, S10, S15, S30, M1, M2, M4, M5, M10, M15, M30, H1, H2, H3, H4, H6, H8, H12, D, W, M")
print("  - Max 5000 candles per request")
print("  - Historical data available back to 2005")

print("\n5. DATA STORAGE CONSIDERATIONS:")
print("-" * 40)
print("For SPtraderB integration:")
print("  - Store ticks in forex_ticks table (similar to Dukascopy)")
print("  - Use continuous aggregates for candles")
print("  - Consider Redis for live tick stream caching")
print("  - Implement rate limiting (OANDA has API limits)")

print("\n6. API RATE LIMITS:")
print("-" * 40)
print("OANDA v20 Rate Limits:")
print("  - Streaming: 20 simultaneous connections")
print("  - REST API: 120 requests per second")
print("  - Historical: Subject to fair use policy")

print("\n7. AUTHENTICATION:")
print("-" * 40)
print("Headers required:")
print("  - Authorization: Bearer {API_KEY}")
print("  - Accept-Datetime-Format: RFC3339")
print("  - Content-Type: application/json")

print("\n8. PRACTICE VS LIVE:")
print("-" * 40)
print("API Endpoints:")
print("  - Practice: https://api-fxpractice.oanda.com")
print("  - Live: https://api-fxtrade.oanda.com")
print("  - Same data structure, different accounts")