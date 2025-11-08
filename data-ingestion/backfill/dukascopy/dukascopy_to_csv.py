import lzma
import struct
import requests
import pandas as pd
from datetime import datetime, timedelta
import logging
from tqdm import tqdm
import time
import os

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class DukascopyCSVIngester:
    def __init__(self, output_dir="./data"):
        self.base_url = "https://datafeed.dukascopy.com/datafeed"
        self.output_dir = output_dir
        self.logger = logging.getLogger(__name__)

        # Create output directory if it doesn't exist
        os.makedirs(output_dir, exist_ok=True)

    def download_bi5_file(self, symbol, date, hour):
        """Download compressed bi5 file for specific hour"""
        url = f"{self.base_url}/{symbol.upper()}/{date.year}/{date.month-1:02d}/{date.day:02d}/{hour:02d}h_ticks.bi5"

        try:
            response = requests.get(url, timeout=30)
            if response.status_code == 404:
                return None  # No data for this hour
            response.raise_for_status()
            return response.content
        except requests.RequestException as e:
            self.logger.error(f"Failed to download {url}: {e}")
            return None

    def parse_bi5_data(self, compressed_data, symbol, base_time):
        """Parse compressed bi5 data into tick records"""
        if not compressed_data:
            return []

        try:
            # Decompress LZMA data
            decompressed = lzma.decompress(compressed_data)

            # Parse binary records (each record is 20 bytes)
            chunk_size = struct.calcsize('>3I2f')
            ticks = []

            for i in range(0, len(decompressed), chunk_size):
                if i + chunk_size > len(decompressed):
                    break

                chunk = decompressed[i:i + chunk_size]
                timestamp_ms, ask_raw, bid_raw, ask_vol, bid_vol = struct.unpack('>3I2f', chunk)

                # Convert to actual prices (Dukascopy uses integer representation)
                # JPY pairs use 3 decimal places, others use 5
                if 'JPY' in symbol.upper():
                    ask_price = ask_raw / 1000.0
                    bid_price = bid_raw / 1000.0
                else:
                    ask_price = ask_raw / 100000.0
                    bid_price = bid_raw / 100000.0

                # Calculate actual timestamp
                tick_time = base_time + timedelta(milliseconds=timestamp_ms)

                ticks.append({
                    'time': tick_time,
                    'symbol': symbol,
                    'ask': ask_price,
                    'bid': bid_price,
                    'ask_size': int(ask_vol * 1000000),
                    'bid_size': int(bid_vol * 1000000)
                })

            return ticks
        except Exception as e:
            self.logger.error(f"Error parsing bi5 data: {e}")
            return []

    def ingest_historical_data(self, symbol, start_date, end_date):
        """Ingest historical data for date range and save to CSV"""
        current_date = start_date
        total_days = (end_date - start_date).days + 1
        all_ticks = []

        with tqdm(total=total_days, desc=f"Downloading {symbol}") as pbar:
            while current_date <= end_date:
                self.logger.info(f"Processing {symbol} for {current_date.date()}")
                daily_ticks = []

                # Download data for each hour of the day
                for hour in range(24):
                    # Add small delay to avoid hitting server too hard
                    time.sleep(0.1)

                    try:
                        # Download hour data
                        compressed_data = self.download_bi5_file(symbol, current_date, hour)

                        if compressed_data:
                            # Parse ticks
                            hour_base = current_date.replace(hour=hour, minute=0, second=0, microsecond=0)
                            ticks = self.parse_bi5_data(compressed_data, symbol, hour_base)
                            daily_ticks.extend(ticks)

                    except Exception as e:
                        self.logger.warning(f"Failed hour {hour}: {e}")
                        continue

                # Add daily ticks to the total collection
                if daily_ticks:
                    all_ticks.extend(daily_ticks)
                    self.logger.info(f"Collected {len(daily_ticks)} ticks for {current_date.date()}")
                else:
                    self.logger.warning(f"No data found for {current_date.date()}")

                current_date += timedelta(days=1)
                pbar.update(1)

        # Save all collected ticks to CSV
        if all_ticks:
            df = pd.DataFrame(all_ticks)

            # Generate filename with date range
            filename = f"{symbol}_{start_date.strftime('%Y%m%d')}_{end_date.strftime('%Y%m%d')}_ticks.csv"
            filepath = os.path.join(self.output_dir, filename)

            # Save to CSV
            df.to_csv(filepath, index=False)

            self.logger.info(f"Saved {len(all_ticks)} ticks to {filepath}")
            print(f"\nData saved to: {filepath}")
            print(f"Total ticks: {len(all_ticks):,}")
            print(f"File size: {os.path.getsize(filepath) / (1024*1024):.2f} MB")

            # Display sample of data
            print("\nFirst 5 ticks:")
            print(df.head())
            print("\nLast 5 ticks:")
            print(df.tail())

            return filepath
        else:
            self.logger.warning("No data collected for the entire period")
            return None

def main():
    import argparse

    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Download forex tick data from Dukascopy to CSV')
    parser.add_argument('--symbol', type=str, required=True, help='Currency pair symbol (e.g., EURUSD)')
    parser.add_argument('--start-date', type=str, required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end-date', type=str, required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--output-dir', type=str, default="./data", help='Output directory for CSV files')

    args = parser.parse_args()

    # Parse dates
    try:
        start_date = datetime.strptime(args.start_date, '%Y-%m-%d')
        end_date = datetime.strptime(args.end_date, '%Y-%m-%d')
    except ValueError as e:
        logger.error(f"Invalid date format: {e}")
        print(f"Error: Invalid date format. Use YYYY-MM-DD")
        return 1

    # Create ingester
    ingester = DukascopyCSVIngester(output_dir=args.output_dir)

    print(f"Starting download of {args.symbol} from {start_date.date()} to {end_date.date()}")
    print(f"Output directory: {args.output_dir}")

    # Ingest the data
    try:
        filepath = ingester.ingest_historical_data(args.symbol, start_date, end_date)
        if filepath:
            print(f"\nData ingestion complete!")
            print(f"CSV file: {filepath}")
        return 0
    except Exception as e:
        logger.error(f"Data ingestion failed: {e}")
        print(f"Error: Data ingestion failed - {e}")
        return 1

if __name__ == "__main__":
    import sys
    sys.exit(main())