import lzma
import struct
import requests
import pandas as pd
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text
import logging
from tqdm import tqdm
import time

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class DukascopyIngester:
    def __init__(self, db_url):
        self.base_url = "https://datafeed.dukascopy.com/datafeed"
        self.engine = create_engine(db_url)
        self.logger = logging.getLogger(__name__)
        
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
        """Ingest historical data for date range"""
        current_date = start_date
        total_days = (end_date - start_date).days + 1
        
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
                
                # Bulk upsert to database
                if daily_ticks:
                    df = pd.DataFrame(daily_ticks)
                    
                    # Use raw SQL with ON CONFLICT for bulk upsert
                    with self.engine.begin() as conn:
                        # Create temp table (without generated columns)
                        conn.execute(text("""
                            CREATE TEMP TABLE temp_ticks (
                                time TIMESTAMPTZ NOT NULL,
                                symbol VARCHAR(10) NOT NULL,
                                bid DECIMAL(10,5) NOT NULL,
                                ask DECIMAL(10,5) NOT NULL,
                                bid_size INTEGER DEFAULT 0,
                                ask_size INTEGER DEFAULT 0
                            ) ON COMMIT DROP
                        """))
                        
                        # Bulk insert into temp table
                        df.to_sql('temp_ticks', conn, if_exists='append', index=False, method='multi')
                        
                        # Upsert from temp table to main table (specify columns)
                        conn.execute(text("""
                            INSERT INTO forex_ticks (time, symbol, bid, ask, bid_size, ask_size)
                            SELECT time, symbol, bid, ask, bid_size, ask_size FROM temp_ticks
                            ON CONFLICT (symbol, time) 
                            DO UPDATE SET 
                                bid = EXCLUDED.bid,
                                ask = EXCLUDED.ask,
                                bid_size = EXCLUDED.bid_size,
                                ask_size = EXCLUDED.ask_size
                        """))
                    
                    self.logger.info(f"Upserted {len(daily_ticks)} ticks for {current_date.date()}")
                else:
                    self.logger.warning(f"No data found for {current_date.date()}")
                
                current_date += timedelta(days=1)
                pbar.update(1)

def main():
    import argparse
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Download forex tick data from Dukascopy')
    parser.add_argument('--symbol', type=str, required=True, help='Currency pair symbol (e.g., EURUSD)')
    parser.add_argument('--start-date', type=str, required=True, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end-date', type=str, required=True, help='End date (YYYY-MM-DD)')
    parser.add_argument('--db-url', type=str, default="postgresql://postgres@localhost:5432/forex_trading",
                       help='Database connection URL')
    
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
    ingester = DukascopyIngester(args.db_url)
    
    print(f"Starting download of {args.symbol} from {start_date.date()} to {end_date.date()}")
    
    # Ingest the data
    try:
        ingester.ingest_historical_data(args.symbol, start_date, end_date)
        print("Data ingestion complete!")
        return 0
    except Exception as e:
        logger.error(f"Data ingestion failed: {e}")
        print(f"Error: Data ingestion failed - {e}")
        return 1

if __name__ == "__main__":
    import sys
    sys.exit(main())