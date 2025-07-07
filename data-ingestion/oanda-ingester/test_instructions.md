# Testing OANDA Ingester

## Prerequisites
1. OANDA practice account (free at https://www.oanda.com/register/)
2. API token from OANDA fxTrade Practice

## Setup Steps

### 1. Get OANDA Credentials
- Log into OANDA fxTrade Practice
- Go to "Manage API Access" 
- Generate an API token
- Note your account ID (format: XXX-XXX-XXXXXXX-XXX)

### 2. Configure Environment
Edit `.env` file:
```bash
OANDA_ACCOUNT_ID=your-account-id-here
OANDA_API_TOKEN=your-token-here
```

### 3. Test Connection Only (No Pulsar)
```bash
# This will test OANDA connection without needing Pulsar
cargo run --bin test_oanda
```

### 4. Full Test with Pulsar

#### Option A: With Docker
```bash
# Start Pulsar
make docker-up

# In another terminal, run the service
cargo run
```

#### Option B: Without Docker (Direct Pulsar)
```bash
# Download Pulsar
wget https://archive.apache.org/dist/pulsar/pulsar-3.2.0/apache-pulsar-3.2.0-bin.tar.gz
tar xvf apache-pulsar-3.2.0-bin.tar.gz
cd apache-pulsar-3.2.0

# Start Pulsar standalone
bin/pulsar standalone

# In another terminal, go back to oanda-ingester and run
cargo run
```

## Verify It's Working

You should see:
1. "Successfully connected to OANDA API"
2. Price updates like: "EUR_USD - Bid: 1.08234, Ask: 1.08245"
3. Periodic heartbeats

## Troubleshooting

### "401 Unauthorized"
- Check API token is correct
- Ensure using practice account URL (stream-fxpractice.oanda.com)

### "Account ID not found"
- Verify account ID format
- Make sure it's a practice account ID

### No price updates
- Forex market may be closed (weekends)
- Check instruments are valid (EUR_USD, USD_JPY)