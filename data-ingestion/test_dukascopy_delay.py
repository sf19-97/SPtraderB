import requests
import lzma
from datetime import datetime, timedelta, timezone
import time

# Use UTC timezone constant
UTC = timezone.utc

class DukascopyDelayTester:
    def __init__(self):
        self.base_url = "https://datafeed.dukascopy.com/datafeed"
        
    def check_hour_availability(self, symbol, date, hour):
        """Check if data is available for a specific hour"""
        url = f"{self.base_url}/{symbol.upper()}/{date.year}/{date.month-1:02d}/{date.day:02d}/{hour:02d}h_ticks.bi5"
        
        try:
            response = requests.head(url, timeout=10)  # HEAD request to check without downloading
            return response.status_code == 200
        except:
            return False
    
    def find_latest_available_data(self, symbol="EURUSD", verbose=True):
        """Find the most recent hour with available data"""
        now = datetime.now(UTC).replace(tzinfo=None)
        if verbose:
            print(f"Current UTC time: {now}")
            print(f"Testing symbol: {symbol}")
            print("-" * 50)
        
        # Start checking from current hour and go backwards
        current_time = now.replace(minute=0, second=0, microsecond=0)
        
        # First, find a rough boundary (check every 6 hours going back)
        if verbose:
            print("Phase 1: Finding rough boundary...")
        hours_back = 0
        while hours_back < 168:  # Check up to 7 days back
            test_time = current_time - timedelta(hours=hours_back)
            available = self.check_hour_availability(symbol, test_time, test_time.hour)
            
            print(f"  {test_time.strftime('%Y-%m-%d %H:00')} UTC - {'Available' if available else 'Not available'}")
            
            if available:
                print(f"\nFound data at {test_time.strftime('%Y-%m-%d %H:00')} UTC")
                break
            
            hours_back += 6
            time.sleep(0.1)  # Be nice to the server
        
        if hours_back >= 168:
            print("No data found in the last 7 days!")
            return None
        
        # Now do a binary search to find the exact boundary
        print(f"\nPhase 2: Finding exact boundary between {hours_back-6} and {hours_back} hours ago...")
        
        # Binary search between last available and first unavailable
        min_hours = max(0, hours_back - 6)
        max_hours = hours_back
        
        while min_hours < max_hours - 1:
            mid_hours = (min_hours + max_hours) // 2
            test_time = current_time - timedelta(hours=mid_hours)
            available = self.check_hour_availability(symbol, test_time, test_time.hour)
            
            print(f"  Testing {mid_hours} hours ago: {test_time.strftime('%Y-%m-%d %H:00')} - {'Available' if available else 'Not available'}")
            
            if available:
                max_hours = mid_hours
            else:
                min_hours = mid_hours
            
            time.sleep(0.1)
        
        # Find the exact cutoff hour
        latest_available = None
        for h in range(min_hours, max_hours + 1):
            test_time = current_time - timedelta(hours=h)
            available = self.check_hour_availability(symbol, test_time, test_time.hour)
            
            if available and latest_available is None:
                latest_available = test_time
                break
            
            time.sleep(0.1)
        
        if latest_available:
            delay = now - latest_available
            print(f"\n{'='*50}")
            print(f"RESULTS:")
            print(f"Latest available data: {latest_available.strftime('%Y-%m-%d %H:00')} UTC")
            print(f"Current time:          {now.strftime('%Y-%m-%d %H:%M:%S')} UTC")
            print(f"Data delay:            {delay.total_seconds() / 3600:.1f} hours ({delay.days} days, {delay.seconds // 3600} hours)")
            print(f"{'='*50}")
            
            return latest_available
        
        return None
    
    def quick_check_latest_hour(self, symbol):
        """Quick check to find the latest available hour without verbose output"""
        now = datetime.now(UTC).replace(tzinfo=None)
        current_time = now.replace(minute=0, second=0, microsecond=0)
        
        # Check last 24 hours
        for hours_back in range(0, 24):
            test_time = current_time - timedelta(hours=hours_back)
            if self.check_hour_availability(symbol, test_time, test_time.hour):
                return test_time
            time.sleep(0.05)  # Small delay
        
        return None
    
    def test_multiple_symbols(self, symbols=["EURUSD", "GBPUSD", "USDJPY"]):
        """Test multiple symbols to see if delay is consistent"""
        print("Testing multiple symbols for consistency...\n")
        print("Symbol    | Latest Available Data | Delay (hours)")
        print("-" * 50)
        
        results = {}
        now = datetime.now(UTC).replace(tzinfo=None)
        
        for symbol in symbols:
            latest = self.quick_check_latest_hour(symbol)
            if latest:
                results[symbol] = latest
                delay = now - latest
                delay_hours = delay.total_seconds() / 3600
                print(f"{symbol:<9} | {latest.strftime('%Y-%m-%d %H:00')} UTC | {delay_hours:.1f}")
            else:
                print(f"{symbol:<9} | Not found             | N/A")
            time.sleep(0.1)  # Small pause between symbols
        
        # Compare results
        if len(results) > 1:
            print("\nCOMPARISON ACROSS SYMBOLS:")
            print("-" * 50)
            for symbol, timestamp in results.items():
                delay = datetime.now(UTC).replace(tzinfo=None) - timestamp
                print(f"{symbol}: {timestamp.strftime('%Y-%m-%d %H:00')} UTC (delay: {delay.total_seconds() / 3600:.1f} hours)")
            
            # Check if all symbols have the same delay
            timestamps = list(results.values())
            if all(ts == timestamps[0] for ts in timestamps):
                print("\n✓ All symbols have the same data availability cutoff")
            else:
                print("\n✗ Different symbols have different data availability")

def main():
    print("Dukascopy Data Availability Delay Tester")
    print("=" * 50)
    print("This script tests how recent data is available from Dukascopy")
    print("without downloading or storing any data.\n")
    
    tester = DukascopyDelayTester()
    
    # Test single symbol first
    tester.find_latest_available_data("EURUSD")
    
    # Test multiple symbols automatically
    print("\n\nTesting multiple symbols to verify consistency...")
    # Test major pairs, crosses, and some exotic pairs
    symbols = [
        "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD", "USDCAD",  # Majors
        "EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "NZDJPY",  # Crosses
        "EURNOK", "EURSEK", "USDMXN", "USDTRY", "USDZAR"   # Exotics
    ]
    tester.test_multiple_symbols(symbols)

if __name__ == "__main__":
    main()