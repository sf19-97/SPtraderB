#!/bin/bash

echo "Testing Oanda API credentials..."
echo "Please enter your credentials (they won't be saved):"
echo

read -p "API Token: " API_TOKEN
read -p "Account ID: " ACCOUNT_ID

echo
echo "Testing connection to Oanda demo API..."
echo "URL: https://api-fxpractice.oanda.com/v3/accounts/$ACCOUNT_ID"
echo

curl -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json" \
     "https://api-fxpractice.oanda.com/v3/accounts/$ACCOUNT_ID" \
     -w "\n\nHTTP Status: %{http_code}\n"

echo
echo "If you see account data above, your credentials are valid."
echo "If you see a 401 error, check:"
echo "1. Is your API token correct? (should be 65 characters)"
echo "2. Is your account ID correct? (format: 101-001-XXXXXXX-001)"
echo "3. Are you using a demo/practice token (not live)?"