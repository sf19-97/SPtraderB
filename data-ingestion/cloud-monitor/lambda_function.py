print("Lambda function loading...")

import json
import urllib.request
from datetime import datetime, timedelta, timezone
import time

# Configuration
SYMBOLS = [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD", "USDCAD",
    "EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "NZDJPY"
]

# Cache settings
cache = {}
CACHE_TTL_SECONDS = 300  # 5 minutes

def lambda_handler(event, context):
    """
    Main Lambda handler - checks Dukascopy data availability
    """
    # Check if we have a specific symbol request
    path = event.get('path', '/')
    
    if path == '/health':
        return {
            'statusCode': 200,
            'body': json.dumps({'status': 'healthy', 'timestamp': datetime.now(timezone.utc).isoformat()})
        }
    
    # Check cache first
    cache_key = 'all_symbols'
    if cache_key in cache:
        cached_data, cached_time = cache[cache_key]
        if time.time() - cached_time < CACHE_TTL_SECONDS:
            print(f"Returning cached data (age: {time.time() - cached_time:.1f}s)")
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Cache-Control': f'max-age={CACHE_TTL_SECONDS}'
                },
                'body': json.dumps(cached_data)
            }
    
    # Check latest data for all symbols
    results = check_all_symbols_fast()
    
    # Cache the results
    cache[cache_key] = (results, time.time())
    
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Cache-Control': f'max-age={CACHE_TTL_SECONDS}'
        },
        'body': json.dumps(results)
    }

def check_all_symbols_fast():
    """
    Check latest available data for all symbols - optimized version
    """
    # Since all symbols typically have the same latest hour, 
    # check EURUSD first, then verify others at that hour
    
    print("Fast checking - finding baseline with EURUSD...")
    baseline_hour = find_latest_available_hour("EURUSD")
    
    if not baseline_hour:
        print("No baseline hour found!")
        return {
            'symbols': {symbol: {'status': 'error', 'latest_available': None} for symbol in SYMBOLS},
            'checked_at': datetime.now(timezone.utc).isoformat(),
            'summary': {'total_symbols': len(SYMBOLS), 'latest_common_hour': None}
        }
    
    print(f"Baseline hour: {baseline_hour}")
    
    # Now quickly verify all symbols have data at this hour
    results = {
        'symbols': {},
        'checked_at': datetime.now(timezone.utc).isoformat(),
        'summary': {
            'total_symbols': len(SYMBOLS),
            'latest_common_hour': baseline_hour.isoformat(),
            'data_delay_hours': (datetime.now(timezone.utc) - baseline_hour).total_seconds() / 3600
        }
    }
    
    # Quick check all symbols at the baseline hour
    for symbol in SYMBOLS:
        if check_hour_availability(symbol, baseline_hour):
            results['symbols'][symbol] = {
                'latest_available': baseline_hour.isoformat(),
                'status': 'ok'
            }
        else:
            # If not available at baseline, do a full search for this symbol
            print(f"{symbol} not available at baseline hour, searching...")
            latest = find_latest_available_hour(symbol)
            results['symbols'][symbol] = {
                'latest_available': latest.isoformat() if latest else None,
                'status': 'ok' if latest else 'no_data'
            }
    
    return results

def find_latest_available_hour(symbol):
    """
    Find the most recent hour with available data for a symbol
    """
    now = datetime.now(timezone.utc)
    current_hour = now.replace(minute=0, second=0, microsecond=0)
    
    # Check backwards from current hour
    # Start with likely delays (1-2 hours)
    for hours_back in [1, 2, 0, 3, 4, 5, 6, 12, 24]:
        check_time = current_hour - timedelta(hours=hours_back)
        
        if check_hour_availability(symbol, check_time):
            print(f"Found data for {symbol} at {check_time}")
            return check_time
    
    return None

def check_hour_availability(symbol, dt):
    """
    Check if data is available for a specific hour using urllib (HEAD request)
    """
    # Dukascopy URL format (month is 0-indexed!)
    url = f"https://datafeed.dukascopy.com/datafeed/{symbol}/{dt.year}/{dt.month-1:02d}/{dt.day:02d}/{dt.hour:02d}h_ticks.bi5"
    
    try:
        # Create a HEAD request
        request = urllib.request.Request(url, method='HEAD')
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status == 200
    except urllib.error.HTTPError as e:
        # 404 is expected when data isn't available yet
        return False
    except Exception as e:
        print(f"Error checking {symbol} at {dt}: {e}")
        return False