#!/usr/bin/env python3
"""
Bitcoin Historical Data Ingester
Downloads historical Bitcoin tick data and imports it into the database
matching the forex_ticks table structure
"""

import psycopg2
import requests
import pandas as pd
from datetime import datetime, timedelta, timezone
import time
import logging
import sys
from typing import List, Tuple, Optional
import json

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('bitcoin_ingestion.log')
    ]
)
logger = logging.getLogger(__name__)


class BitcoinHistoricalIngester:
    def __init__(self, db_url: str):
        self.db_url = db_url
        self.symbol = "BTCUSD"
        
    def connect_db(self):
        """Connect to PostgreSQL database"""
        try:
            self.conn = psycopg2.connect(self.db_url)
            self.cur = self.conn.cursor()
            logger.info("Connected to database")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            return False
    
    def close_db(self):
        """Close database connection"""
        if hasattr(self, 'cur'):
            self.cur.close()
        if hasattr(self, 'conn'):
            self.conn.close()
    
    def fetch_binance_klines(self, start_time: datetime, end_time: datetime, interval: str = "1m"):
        """
        Fetch historical kline data from Binance public API
        No API key required for public market data
        """
        url = "https://api.binance.com/api/v3/klines"
        
        all_data = []
        current_start = int(start_time.timestamp() * 1000)
        end_timestamp = int(end_time.timestamp() * 1000)
        
        while current_start < end_timestamp:
            params = {
                'symbol': 'BTCUSDT',  # Binance uses BTCUSDT
                'interval': interval,
                'startTime': current_start,
                'limit': 1000  # Max 1000 per request
            }
            
            try:
                logger.info(f"Fetching data from {datetime.fromtimestamp(current_start/1000)}")
                response = requests.get(url, params=params)
                response.raise_for_status()
                
                data = response.json()
                if not data:
                    break
                    
                all_data.extend(data)
                
                # Move to next batch
                last_timestamp = data[-1][0]
                current_start = last_timestamp + 1
                
                # Rate limit: 1200 requests per minute
                time.sleep(0.1)
                
            except Exception as e:
                logger.error(f"Error fetching Binance data: {e}")
                break
        
        return all_data
    
    def convert_klines_to_ticks(self, klines_data: List) -> List[Tuple]:
        """
        Convert Binance kline data to tick format matching forex_ticks structure
        Creates synthetic bid/ask from OHLC data
        """
        ticks = []
        
        for kline in klines_data:
            # Kline format: [timestamp, open, high, low, close, volume, ...]
            timestamp = datetime.fromtimestamp(kline[0] / 1000, tz=timezone.utc)
            close_price = float(kline[4])
            
            # Create synthetic bid/ask with small spread (0.01%)
            spread_bps = 1  # 1 basis point = 0.01%
            half_spread = close_price * (spread_bps / 10000) / 2
            
            bid = round(close_price - half_spread, 2)
            ask = round(close_price + half_spread, 2)
            
            # Use volume as proxy for size
            volume = float(kline[5])
            size = min(int(volume * 1000), 999999)  # Cap at reasonable size
            
            ticks.append((
                timestamp,
                self.symbol,
                bid,
                ask,
                size,  # bid_size
                size   # ask_size
            ))
        
        return ticks
    
    def insert_ticks(self, ticks: List[Tuple]) -> int:
        """Insert tick data into bitcoin_ticks table using UPSERT"""
        if not ticks:
            return 0
            
        insert_query = """
            INSERT INTO bitcoin_ticks (time, symbol, bid, ask, bid_size, ask_size)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (symbol, time) 
            DO UPDATE SET 
                bid = EXCLUDED.bid,
                ask = EXCLUDED.ask,
                bid_size = EXCLUDED.bid_size,
                ask_size = EXCLUDED.ask_size
        """
        
        try:
            self.cur.executemany(insert_query, ticks)
            self.conn.commit()
            return len(ticks)
        except Exception as e:
            logger.error(f"Error inserting ticks: {e}")
            self.conn.rollback()
            return 0
    
    def refresh_candles(self, start_time: datetime, end_time: datetime):
        """Refresh continuous aggregates for the given time range"""
        try:
            logger.info("Refreshing continuous aggregates...")
            
            # Call the helper function we created
            self.cur.execute(
                "SELECT refresh_bitcoin_candles(%s, %s, %s)",
                (self.symbol, start_time, end_time)
            )
            self.conn.commit()
            
            logger.info("Continuous aggregates refreshed successfully")
            
        except Exception as e:
            logger.error(f"Error refreshing candles: {e}")
            self.conn.rollback()
    
    def get_latest_tick_time(self) -> Optional[datetime]:
        """Get the latest tick timestamp for Bitcoin"""
        try:
            self.cur.execute(
                "SELECT MAX(time) FROM bitcoin_ticks WHERE symbol = %s",
                (self.symbol,)
            )
            result = self.cur.fetchone()
            return result[0] if result and result[0] else None
        except Exception as e:
            logger.error(f"Error getting latest tick time: {e}")
            return None
    
    def ingest_historical_data(self, days_back: int = 7):
        """Main ingestion function"""
        if not self.connect_db():
            return
        
        try:
            # Check existing data
            latest_tick = self.get_latest_tick_time()
            
            if latest_tick:
                start_time = latest_tick + timedelta(seconds=1)
                logger.info(f"Resuming from {start_time}")
            else:
                start_time = datetime.now(timezone.utc) - timedelta(days=days_back)
                logger.info(f"Starting fresh from {start_time}")
            
            end_time = datetime.now(timezone.utc)
            
            # Fetch data from Binance
            logger.info(f"Fetching Bitcoin data from {start_time} to {end_time}")
            klines_data = self.fetch_binance_klines(start_time, end_time)
            
            if not klines_data:
                logger.warning("No data fetched")
                return
            
            logger.info(f"Fetched {len(klines_data)} klines")
            
            # Convert to tick format
            ticks = self.convert_klines_to_ticks(klines_data)
            logger.info(f"Converted to {len(ticks)} ticks")
            
            # Insert in batches
            batch_size = 1000
            total_inserted = 0
            
            for i in range(0, len(ticks), batch_size):
                batch = ticks[i:i + batch_size]
                inserted = self.insert_ticks(batch)
                total_inserted += inserted
                
                if i % 10000 == 0:
                    logger.info(f"Progress: {i}/{len(ticks)} ticks inserted")
            
            logger.info(f"Total ticks inserted: {total_inserted}")
            
            # Refresh continuous aggregates
            if total_inserted > 0:
                self.refresh_candles(start_time, end_time)
            
            # Verify data
            self.cur.execute(
                "SELECT COUNT(*), MIN(time), MAX(time) FROM bitcoin_ticks WHERE symbol = %s",
                (self.symbol,)
            )
            count, min_time, max_time = self.cur.fetchone()
            logger.info(f"Bitcoin ticks in database: {count} records from {min_time} to {max_time}")
            
        except Exception as e:
            logger.error(f"Ingestion failed: {e}")
        finally:
            self.close_db()


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Ingest historical Bitcoin data')
    parser.add_argument('--days', type=int, default=7, help='Days of history to fetch')
    parser.add_argument('--db-url', default='postgresql://postgres@localhost:5432/forex_trading',
                       help='Database connection URL')
    
    args = parser.parse_args()
    
    ingester = BitcoinHistoricalIngester(args.db_url)
    ingester.ingest_historical_data(args.days)


if __name__ == '__main__':
    main()