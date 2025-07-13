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
import aiohttp
import asyncio

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
        
    async def download_bi5_file(self, session, symbol, date, hour):
        """Download compressed bi5 file for specific hour"""
        # Dukascopy uses 0-indexed months
        url = f"{self.base_url}/{symbol.upper()}/{date.year}/{date.month-1:02d}/{date.day:02d}/{hour:02d}h_ticks.bi5"
        
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as response:
                if response.status == 404:
                    return None  # No data for this hour
                response.raise_for_status()
                return await response.read()
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
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
    
    async def download_day_data_async(self, session, symbol, date, semaphore):
        """Download all tick data for a specific day concurrently"""
        all_ticks = []
        
        # Create tasks for all hours of the day
        tasks = []
        for hour in range(24):
            base_time = datetime(date.year, date.month, date.day, hour, 0, 0)
            task = self.download_hour_with_semaphore(session, symbol, date, hour, base_time, semaphore)
            tasks.append(task)
        
        # Download all hours concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        for hour, result in enumerate(results):
            if isinstance(result, Exception):
                self.logger.error(f"Error downloading hour {hour}: {result}")
            elif result:
                all_ticks.extend(result)
                self.logger.info(f"Downloaded {len(result)} ticks for {symbol} on {date.strftime('%Y-%m-%d')} hour {hour:02d}")
        
        return all_ticks
    
    async def download_hour_with_semaphore(self, session, symbol, date, hour, base_time, semaphore):
        """Download and parse data for a single hour with semaphore limit and retry logic"""
        async with semaphore:
            for attempt in range(3):  # 3 attempts
                compressed_data = await self.download_bi5_file(session, symbol, date, hour)
                if compressed_data:
                    return self.parse_bi5_data(compressed_data, symbol, base_time)
                elif attempt < 2:  # Don't sleep on last attempt
                    await asyncio.sleep(2 ** attempt)  # 1s, 2s backoff
            return []
    
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
                # Fix: Use CALL instead of SELECT for procedures
                for timeframe in ['5m', '15m', '1h', '4h', '12h']:
                    conn.execute(
                        text(f"CALL refresh_continuous_aggregate('bitcoin_candles_{timeframe}', :start_time, :end_time)"),
                        {
                            "start_time": start_date,
                            "end_time": end_date + timedelta(days=1)
                        }
                    )
                self.logger.info(f"Refreshed continuous aggregates for {symbol}")
        except Exception as e:
            self.logger.error(f"Failed to refresh candles: {e}")
    
    async def ingest_date_range_async(self, symbol, start_date, end_date):
        """Ingest data for a date range using async concurrent downloads"""
        if symbol not in self.crypto_symbols:
            self.logger.error(f"Symbol {symbol} not supported. Available: {self.crypto_symbols}")
            return
            
        total_ticks = 0
        
        # Create semaphore to limit concurrent connections (25 concurrent downloads to avoid rate limits)
        semaphore = asyncio.Semaphore(25)
        
        # Create aiohttp session with connection pool
        connector = aiohttp.TCPConnector(limit=25, limit_per_host=25)
        async with aiohttp.ClientSession(connector=connector) as session:
            current_date = start_date
            
            # Process in batches of days for better memory management
            batch_size = 7  # Process 7 days at a time (168 concurrent downloads)
            
            with tqdm(total=(end_date - start_date).days + 1, desc=f"Downloading {symbol}") as pbar:
                while current_date <= end_date:
                    # Calculate batch end date
                    batch_end = min(current_date + timedelta(days=batch_size - 1), end_date)
                    
                    # Create tasks for all days in batch
                    batch_tasks = []
                    batch_date = current_date
                    while batch_date <= batch_end:
                        task = self.download_day_data_async(session, symbol, batch_date, semaphore)
                        batch_tasks.append((batch_date, task))
                        batch_date += timedelta(days=1)
                    
                    # Download batch concurrently
                    for date, task in batch_tasks:
                        day_ticks = await task
                        
                        if day_ticks:
                            # Convert to DataFrame and save
                            df = pd.DataFrame(day_ticks)
                            self.save_to_database(df)
                            total_ticks += len(day_ticks)
                            self.logger.info(f"Saved {len(day_ticks)} ticks for {date.strftime('%Y-%m-%d')}")
                        
                        pbar.update(1)
                    
                    # Move to next batch
                    current_date = batch_end + timedelta(days=1)
        
        self.logger.info(f"Total ticks downloaded: {total_ticks}")
        
        # Refresh continuous aggregates
        if total_ticks > 0:
            self.refresh_candles(symbol, start_date, end_date)
    
    def ingest_date_range(self, symbol, start_date, end_date):
        """Synchronous wrapper for async ingestion"""
        asyncio.run(self.ingest_date_range_async(symbol, start_date, end_date))
    
    def find_missing_hours(self, symbol, start_date, end_date):
        """Find missing hours in the database"""
        query = """
        WITH all_hours AS (
            SELECT date_trunc('hour', generate_series(%(start_date)s::timestamp, %(end_date)s::timestamp, '1 hour'::interval)) as hour
        ),
        existing_hours AS (
            SELECT date_trunc('hour', time) as hour
            FROM bitcoin_ticks
            WHERE symbol = %(symbol)s
            AND time >= %(start_date)s AND time <= %(end_date)s
            GROUP BY date_trunc('hour', time)
        )
        SELECT ah.hour
        FROM all_hours ah
        LEFT JOIN existing_hours eh ON ah.hour = eh.hour
        WHERE eh.hour IS NULL
        ORDER BY ah.hour
        """
        
        with self.engine.connect() as conn:
            result = conn.execute(
                text(query),
                {
                    "start_date": start_date,
                    "end_date": end_date,
                    "symbol": symbol
                }
            )
            missing_hours = [row[0] for row in result]
            
        return missing_hours
    
    async def fill_gaps_async(self, symbol):
        """Find and fill missing hours in the database"""
        # First, find the data range
        with self.engine.connect() as conn:
            result = conn.execute(
                text("SELECT MIN(time), MAX(time) FROM bitcoin_ticks WHERE symbol = :symbol"),
                {"symbol": symbol}
            )
            row = result.fetchone()
            if not row or not row[0]:
                self.logger.error("No existing data found")
                return
            
            start_date = row[0].replace(hour=0, minute=0, second=0, microsecond=0)
            end_date = row[1].replace(hour=23, minute=59, second=59, microsecond=999999)
        
        # Find missing hours
        missing_hours = self.find_missing_hours(symbol, start_date, end_date)
        
        if not missing_hours:
            self.logger.info("No missing hours found!")
            return
        
        self.logger.info(f"Found {len(missing_hours)} missing hours")
        
        # Group missing hours by date
        missing_by_date = {}
        for hour in missing_hours:
            date = hour.date()
            if date not in missing_by_date:
                missing_by_date[date] = []
            missing_by_date[date].append(hour.hour)
        
        # Log summary
        for date, hours in sorted(missing_by_date.items()):
            self.logger.info(f"{date}: Missing hours {sorted(hours)}")
        
        # Download missing data
        total_ticks = 0
        semaphore = asyncio.Semaphore(25)
        connector = aiohttp.TCPConnector(limit=25, limit_per_host=25)
        
        async with aiohttp.ClientSession(connector=connector) as session:
            # Process each date with missing hours
            with tqdm(total=len(missing_hours), desc=f"Filling gaps for {symbol}") as pbar:
                for date, hours in sorted(missing_by_date.items()):
                    tasks = []
                    for hour in hours:
                        base_time = datetime(date.year, date.month, date.day, hour, 0, 0)
                        task = self.download_hour_with_semaphore(session, symbol, date, hour, base_time, semaphore)
                        tasks.append((hour, task))
                    
                    # Download missing hours for this date
                    day_ticks = []
                    for hour, task in tasks:
                        ticks = await task
                        if ticks:
                            day_ticks.extend(ticks)
                            self.logger.info(f"Filled {len(ticks)} ticks for {date} hour {hour:02d}")
                        else:
                            self.logger.warning(f"Still no data for {date} hour {hour:02d}")
                        pbar.update(1)
                    
                    # Save if we got any data
                    if day_ticks:
                        df = pd.DataFrame(day_ticks)
                        self.save_to_database(df)
                        total_ticks += len(day_ticks)
        
        self.logger.info(f"Filled {total_ticks} ticks total")
        
        # Verify the gaps were filled
        remaining_missing = self.find_missing_hours(symbol, start_date, end_date)
        if remaining_missing:
            self.logger.warning(f"Still have {len(remaining_missing)} missing hours after gap fill")
        else:
            self.logger.info("All gaps successfully filled!")
    
    def fill_gaps(self, symbol):
        """Synchronous wrapper for gap filling"""
        asyncio.run(self.fill_gaps_async(symbol))
    
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
    parser.add_argument('--start-date', 
                       type=lambda s: datetime.strptime(s, '%Y-%m-%d'),
                       help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end-date',
                       type=lambda s: datetime.strptime(s, '%Y-%m-%d'),
                       help='End date (YYYY-MM-DD)')
    parser.add_argument('--db-url', default='postgresql://postgres@localhost:5432/forex_trading',
                       help='Database URL')
    parser.add_argument('--fill-gaps', action='store_true',
                       help='Scan database for missing hours and fill them')
    
    args = parser.parse_args()
    
    # Create ingester
    ingester = DukascopyBitcoinIngester(args.db_url)
    
    if args.fill_gaps:
        # Fill gaps mode - scan and fill missing hours
        ingester.fill_gaps(args.symbol)
    else:
        # Normal ingestion mode - require dates
        if not args.start_date or not args.end_date:
            parser.error("--start-date and --end-date are required when not using --fill-gaps")
        ingester.ingest_date_range(args.symbol, args.start_date, args.end_date)
    
    # Always show summary at the end
    ingester.get_data_summary(args.symbol)


if __name__ == '__main__':
    main()