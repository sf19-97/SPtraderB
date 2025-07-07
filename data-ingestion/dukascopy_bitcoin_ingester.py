#!/usr/bin/env python3
"""
Dukascopy Bitcoin Ingester
Downloads historical Bitcoin tick data from Dukascopy and imports into bitcoin_ticks table
Based on the forex ingester but adapted for cryptocurrency data
"""

import lzma
import struct
import requests
import pandas as pd
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text
import logging
from tqdm import tqdm
import time
import sys

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class DukascopyBitcoinIngester:
    def __init__(self, db_url):
        self.base_url = "https://datafeed.dukascopy.com/datafeed"
        self.engine = create_engine(db_url)
        self.logger = logging.getLogger(__name__)
        
        # Cryptocurrency symbols available on Dukascopy
        self.crypto_symbols = {
            'BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'BCHUSD',
            'BTCEUR', 'ETHEUR'
        }
        
    def download_bi5_file(self, symbol, date, hour):
        """Download compressed bi5 file for specific hour"""
        # Dukascopy uses 0-indexed months
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
                    
                # Unpack: time_offset(ms), ask, bid, ask_volume, bid_volume
                time_offset, ask_raw, bid_raw, ask_vol, bid_vol = struct.unpack(
                    '>3I2f', decompressed[i:i+chunk_size]
                )
                
                # Calculate actual timestamp
                tick_time = base_time + timedelta(milliseconds=time_offset)
                
                # IMPORTANT: Bitcoin in Dukascopy needs to be divided by 10
                # Raw value 943502 = $94,350.20
                ask_price = ask_raw / 10.0
                bid_price = bid_raw / 10.0
                
                # Convert volumes to integers
                ask_size = int(ask_vol * 1000000) if ask_vol > 0 else 0
                bid_size = int(bid_vol * 1000000) if bid_vol > 0 else 0
                
                ticks.append({
                    'time': tick_time,
                    'symbol': symbol,
                    'bid': bid_price,
                    'ask': ask_price,
                    'bid_size': bid_size,
                    'ask_size': ask_size
                })
                
            return ticks
            
        except Exception as e:
            self.logger.error(f"Failed to parse bi5 data: {e}")
            return []
    
    def download_day_data(self, symbol, date):
        """Download all tick data for a specific day"""
        all_ticks = []
        
        # Download data for each hour of the day
        for hour in range(24):
            base_time = datetime(date.year, date.month, date.day, hour, 0, 0)
            
            # Download bi5 file
            compressed_data = self.download_bi5_file(symbol, date, hour)
            if compressed_data:
                # Parse ticks
                ticks = self.parse_bi5_data(compressed_data, symbol, base_time)
                all_ticks.extend(ticks)
                
                self.logger.info(f"Downloaded {len(ticks)} ticks for {symbol} on {date.strftime('%Y-%m-%d')} hour {hour:02d}")
            
            # Rate limiting to be nice to Dukascopy servers
            time.sleep(0.1)
        
        return all_ticks
    
    def save_to_database(self, ticks_df):
        """Save tick data to bitcoin_ticks table"""
        if ticks_df.empty:
            return
            
        try:
            # Use UPSERT to handle duplicates
            with self.engine.begin() as conn:
                # Create temp table
                ticks_df.to_sql('temp_bitcoin_ticks', conn, if_exists='replace', index=False)
                
                # UPSERT from temp table
                conn.execute(text("""
                    INSERT INTO bitcoin_ticks (time, symbol, bid, ask, bid_size, ask_size)
                    SELECT time, symbol, bid, ask, bid_size, ask_size
                    FROM temp_bitcoin_ticks
                    ON CONFLICT (symbol, time) 
                    DO UPDATE SET 
                        bid = EXCLUDED.bid,
                        ask = EXCLUDED.ask,
                        bid_size = EXCLUDED.bid_size,
                        ask_size = EXCLUDED.ask_size
                """))
                
                # Drop temp table
                conn.execute(text("DROP TABLE temp_bitcoin_ticks"))
                
            self.logger.info(f"Saved {len(ticks_df)} ticks to database")
            
        except Exception as e:
            self.logger.error(f"Failed to save to database: {e}")
            raise
    
    def refresh_candles(self, symbol, start_date, end_date):
        """Refresh continuous aggregates after ingestion"""
        try:
            with self.engine.begin() as conn:
                result = conn.execute(
                    text("SELECT refresh_bitcoin_candles(:symbol, :start_time, :end_time)"),
                    {
                        "symbol": symbol,
                        "start_time": start_date,
                        "end_time": end_date + timedelta(days=1)
                    }
                )
                self.logger.info(f"Refreshed continuous aggregates for {symbol}")
        except Exception as e:
            self.logger.error(f"Failed to refresh candles: {e}")
    
    def ingest_date_range(self, symbol, start_date, end_date):
        """Ingest data for a date range"""
        if symbol not in self.crypto_symbols:
            self.logger.error(f"Symbol {symbol} not supported. Available: {self.crypto_symbols}")
            return
            
        current_date = start_date
        total_ticks = 0
        
        with tqdm(total=(end_date - start_date).days + 1, desc=f"Downloading {symbol}") as pbar:
            while current_date <= end_date:
                # Always download - let UPSERT handle duplicates
                day_ticks = self.download_day_data(symbol, current_date)
                
                if day_ticks:
                    # Convert to DataFrame and save
                    df = pd.DataFrame(day_ticks)
                    self.save_to_database(df)
                    total_ticks += len(day_ticks)
                
                current_date += timedelta(days=1)
                pbar.update(1)
        
        self.logger.info(f"Total ticks downloaded: {total_ticks}")
        
        # Refresh continuous aggregates
        if total_ticks > 0:
            self.refresh_candles(symbol, start_date, end_date)
    
    def get_data_summary(self, symbol):
        """Get summary of data in database"""
        with self.engine.connect() as conn:
            result = conn.execute(
                text("""
                    SELECT 
                        COUNT(*) as tick_count,
                        MIN(time) as first_tick,
                        MAX(time) as last_tick
                    FROM bitcoin_ticks
                    WHERE symbol = :symbol
                """),
                {"symbol": symbol}
            )
            row = result.fetchone()
            
            if row and row[0] > 0:
                self.logger.info(f"\n{symbol} Summary:")
                self.logger.info(f"  Total ticks: {row[0]:,}")
                self.logger.info(f"  First tick: {row[1]}")
                self.logger.info(f"  Last tick: {row[2]}")
                
                # Check candles
                for timeframe in ['5m', '15m', '1h', '4h', '12h']:
                    result = conn.execute(
                        text(f"""
                            SELECT COUNT(*) 
                            FROM bitcoin_candles_{timeframe}
                            WHERE symbol = :symbol
                        """),
                        {"symbol": symbol}
                    )
                    candle_count = result.fetchone()[0]
                    self.logger.info(f"  {timeframe} candles: {candle_count:,}")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Download Bitcoin data from Dukascopy')
    parser.add_argument('--symbol', default='BTCUSD', 
                       choices=['BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'BCHUSD', 'BTCEUR', 'ETHEUR'],
                       help='Cryptocurrency symbol to download')
    parser.add_argument('--start-date', required=True, 
                       type=lambda s: datetime.strptime(s, '%Y-%m-%d'),
                       help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end-date', required=True,
                       type=lambda s: datetime.strptime(s, '%Y-%m-%d'),
                       help='End date (YYYY-MM-DD)')
    parser.add_argument('--db-url', default='postgresql://postgres@localhost:5432/forex_trading',
                       help='Database URL')
    
    args = parser.parse_args()
    
    # Create ingester and run
    ingester = DukascopyBitcoinIngester(args.db_url)
    ingester.ingest_date_range(args.symbol, args.start_date, args.end_date)
    ingester.get_data_summary(args.symbol)


if __name__ == '__main__':
    main()