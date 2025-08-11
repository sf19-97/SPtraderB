# Broker Setup Guide

## Overview
SPtraderB stores broker profiles securely in your browser's local storage with basic encryption. Your API credentials are never committed to git.

## Setting Up Broker Profiles

### Method 1: Through the UI (Recommended)
1. Click the settings icon in the left sidebar
2. Navigate to "Broker Profiles" tab
3. Click "Add Profile"
4. Enter your broker details
5. Click "Add Profile" to save

### Method 2: Environment Variables (For Development)
1. Copy `.env.example` to `.env.local`
2. Add your demo/paper trading credentials:
   ```env
   VITE_OANDA_DEMO_API_KEY=your-api-key
   VITE_OANDA_DEMO_ACCOUNT_ID=your-account-id
   ```
3. Restart the development server
4. The profile will auto-populate on first load

## Security Notes

### What's Stored
- Profiles are stored in browser localStorage
- API keys are encrypted (basic base64 - use stronger encryption for production)
- Data persists across sessions
- Each browser/device has its own profiles

### What's NOT Stored
- Nothing is saved to the git repository
- `.env.local` files are gitignored
- No credentials are sent to any server

## Supported Brokers

### OANDA
- Supports both live and practice accounts
- API key from OANDA dashboard
- Account format: XXX-XXX-XXXXXXX-XXX

### Interactive Brokers
- Paper trading and live accounts
- Requires IB Gateway or TWS running
- Account format: UXXXXXXX

### Alpaca
- Paper and live trading
- Requires API key and secret
- Account format: Alpaca account ID

## Managing Profiles

### Activate a Profile
- Click "Activate" button on any inactive profile
- Only one profile can be active at a time
- Active profile is used for all trading operations

### Edit a Profile
- Click "Edit" to modify credentials
- Changes are saved immediately
- Re-encryption happens automatically

### Delete a Profile
- Click "Delete" to remove a profile
- Active profiles cannot be deleted
- Deletion is permanent

## Troubleshooting

### Profiles Not Persisting
- Check browser settings for localStorage
- Try a different browser
- Clear browser data and re-add profiles

### Can't See Environment Variables
- Ensure file is named `.env.local` (not `.env`)
- Restart the development server after adding
- Check for VITE_ prefix on all variables

## Best Practices
1. Use paper/demo accounts for testing
2. Regularly rotate API keys
3. Don't share localStorage data
4. Use different profiles for different strategies
5. Test connection before live trading