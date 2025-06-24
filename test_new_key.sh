#!/bin/bash

API_KEY="599289f40105f4990595e53da4d05473-aff0283ed6b217cbbac90a1a5932f19e"
ACCOUNT_ID="101-001-25044301-001"

echo "Testing new OANDA API key..."
echo "Account: $ACCOUNT_ID"
echo

curl -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     "https://api-fxpractice.oanda.com/v3/accounts/$ACCOUNT_ID" \
     -w "\n\nHTTP Status: %{http_code}\n"