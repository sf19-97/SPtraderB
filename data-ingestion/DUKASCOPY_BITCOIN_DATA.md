# Dukascopy Bitcoin Data Documentation

## Overview
Dukascopy provides historical tick data for Bitcoin and other cryptocurrencies through the same API endpoint used for forex data. This allows us to reuse the existing ingestion infrastructure with minimal modifications.

## Available Cryptocurrency Symbols

### Confirmed Available
- **BTCUSD** - Bitcoin vs US Dollar
- **ETHUSD** - Ethereum vs US Dollar  
- **LTCUSD** - Litecoin vs US Dollar
- **XRPUSD** - Ripple vs US Dollar
- **BCHUSD** - Bitcoin Cash vs US Dollar
- **BTCEUR** - Bitcoin vs Euro
- **ETHEUR** - Ethereum vs Euro

### Not Available
- **BTCJPY** - Bitcoin vs Japanese Yen (not found in tests)

## URL Format
The URL format is identical to forex data:
```
https://datafeed.dukascopy.com/datafeed/{SYMBOL}/{YEAR}/{MONTH-1}/{DAY}/{HOUR}h_ticks.bi5
```

Example for Bitcoin:
```
https://datafeed.dukascopy.com/datafeed/BTCUSD/2024/00/01/12h_ticks.bi5
```

## Data Format Differences

### Price Decimal Places
- **Forex**: Uses 5 decimal places (except JPY pairs which use 3)
- **Bitcoin**: Uses 2 decimal places
  - Raw value: 4250000 = $42,500.00
  - Divide by 100 instead of 100000

### Data Availability
- Same delay as forex data (~1-2 hours from real-time)
- 24/7 data availability (no weekend gaps like forex)
- Historical data available back several years

## Implementation

### Using Existing Ingester
The existing `dukascopy_ingester.py` can be adapted for Bitcoin with these changes:

1. **Price Conversion**: Change decimal handling for crypto symbols
```python
if symbol in ['BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'BCHUSD']:
    ask_price = ask_raw / 100.0    # 2 decimal places
    bid_price = bid_raw / 100.0
else:
    # Standard forex handling
    if 'JPY' in symbol.upper():
        ask_price = ask_raw / 1000.0
        bid_price = bid_raw / 1000.0
    else:
        ask_price = ask_raw / 100000.0
        bid_price = bid_raw / 100000.0
```

2. **Database Table**: Use `bitcoin_ticks` table instead of `forex_ticks`

### Dedicated Bitcoin Ingester
Created `dukascopy_bitcoin_ingester.py` specifically for cryptocurrency data:
- Handles 2 decimal place conversion
- Writes to `bitcoin_ticks` table
- Same command-line interface as forex ingester

## Usage Examples

### Download Bitcoin Data
```bash
python dukascopy_bitcoin_ingester.py \
    --symbol BTCUSD \
    --start-date 2024-01-01 \
    --end-date 2024-01-07 \
    --db-url "postgresql://postgres@localhost:5432/forex_trading"
```

### Download Ethereum Data
```bash
python dukascopy_bitcoin_ingester.py \
    --symbol ETHUSD \
    --start-date 2024-01-01 \
    --end-date 2024-01-07 \
    --db-url "postgresql://postgres@localhost:5432/forex_trading"
```

## Integration with Auto-Ingester

To add Bitcoin to the auto-ingester monitoring:

1. Update `config.yaml`:
```yaml
symbols:
  forex:
    - EURUSD
    - USDJPY
  crypto:
    - BTCUSD
    - ETHUSD
```

2. Modify `monitor.py` to handle crypto symbols:
- Use appropriate decimal conversion
- Write to `bitcoin_ticks` table
- Call `refresh_bitcoin_candles()` instead of forex version

## Testing

Use the provided test script to verify Bitcoin data availability:
```bash
python test_dukascopy_bitcoin.py
```

This will:
- Check availability of various crypto symbols
- Test data parsing
- Show current data delay

## Notes

1. **Data Quality**: Same high quality as forex data
2. **Volume Data**: Volume fields represent Dukascopy's internal metrics, not actual market volume
3. **Spread**: Bitcoin typically has wider spreads than major forex pairs
4. **Market Hours**: 24/7 trading means no gaps in data (unlike forex weekends)
5. **Historical Depth**: Data available from approximately 2017 for major cryptocurrencies