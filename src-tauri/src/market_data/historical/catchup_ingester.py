#!/usr/bin/env python3
"""
Catchup Ingester for Market Data Pipelines

This script handles gap filling when pipelines are restored after downtime.
It uses Dukascopy as the historical data source for forex pairs.

Usage:
    python3 catchup_ingester.py --symbol EURUSD --from "2024-01-15T10:30:00Z" --to "2024-01-15T11:00:00Z"
"""

import argparse
import lzma
import struct
import requests
import pandas as pd
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text
import logging
import sys
import os
from typing import List, Dict, Optional

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class CatchupIngester:
    def __init__(self, db_url: str = None):
        """Initialize the catchup ingester"""
        self.base_url = "https://datafeed.dukascopy.com/datafeed"
        
        # Use environment variable if db_url not provided
        if not db_url:
            db_url = os.getenv('DATABASE_URL', 'postgresql://postgres@localhost:5432/forex_trading')
        
        self.engine = create_engine(db_url)
        self.logger = logging.getLogger(__name__)
        
    def download_bi5_file(self, symbol: str, date: datetime, hour: int) -> Optional[bytes]:
        """Download compressed bi5 file for specific hour"""
        # Dukascopy uses 0-based month numbering
        url = f"{self.base_url}/{symbol.upper()}/{date.year}/{date.month-1:02d}/{date.day:02d}/{hour:02d}h_ticks.bi5"
        
        try:
            response = requests.get(url, timeout=30)
            if response.status_code == 404:
                self.logger.debug(f"No data available for {symbol} at {date.date()} {hour:02d}:00")
                return None
            response.raise_for_status()
            return response.content
        except requests.RequestException as e:
            self.logger.error(f"Failed to download {url}: {e}")
            return None
    
    def parse_bi5_data(self, compressed_data: bytes, symbol: str, base_time: datetime) -> List[Dict]:
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
                    'bid_size': int(bid_vol * 1000000),
                    'source': 'dukascopy'  # Mark as historical data
                })
            
            return ticks
        except Exception as e:
            self.logger.error(f"Error parsing bi5 data: {e}")
            return []
    
    def catchup_gap(self, symbol: str, from_time: datetime, to_time: datetime) -> Dict[str, int]:
        """
        Fill data gap for a specific symbol and time range
        
        Returns:
            Dict with statistics: {'ticks_inserted': n, 'hours_processed': n}
        """
        stats = {'ticks_inserted': 0, 'hours_processed': 0}
        
        # Ensure we're working with UTC
        if from_time.tzinfo is None:
            from_time = from_time.replace(tzinfo=datetime.timezone.utc)
        if to_time.tzinfo is None:
            to_time = to_time.replace(tzinfo=datetime.timezone.utc)
        
        self.logger.info(f"Starting catchup for {symbol} from {from_time} to {to_time}")
        
        # Round down to hour boundary for from_time
        current_hour = from_time.replace(minute=0, second=0, microsecond=0)
        
        all_ticks = []
        
        while current_hour <= to_time:
            try:
                # Download hour data
                compressed_data = self.download_bi5_file(
                    symbol, 
                    current_hour, 
                    current_hour.hour
                )
                
                if compressed_data:
                    # Parse ticks
                    ticks = self.parse_bi5_data(compressed_data, symbol, current_hour)
                    
                    # Filter ticks to only include those within our time range
                    filtered_ticks = [
                        tick for tick in ticks 
                        if from_time <= tick['time'] <= to_time
                    ]
                    
                    if filtered_ticks:
                        all_ticks.extend(filtered_ticks)
                        self.logger.info(
                            f"Found {len(filtered_ticks)} ticks for {current_hour.strftime('%Y-%m-%d %H:00')}"
                        )
                
                stats['hours_processed'] += 1
                
            except Exception as e:
                self.logger.error(f"Failed to process hour {current_hour}: {e}")
            
            # Move to next hour
            current_hour += timedelta(hours=1)
        
        # Bulk insert all ticks
        if all_ticks:
            try:
                df = pd.DataFrame(all_ticks)
                
                with self.engine.begin() as conn:
                    # Create temp table
                    conn.execute(text("""
                        CREATE TEMP TABLE temp_catchup_ticks (
                            time TIMESTAMPTZ NOT NULL,
                            symbol VARCHAR(10) NOT NULL,
                            bid DECIMAL(10,5) NOT NULL,
                            ask DECIMAL(10,5) NOT NULL,
                            bid_size INTEGER DEFAULT 0,
                            ask_size INTEGER DEFAULT 0,
                            source VARCHAR(20) DEFAULT 'dukascopy'
                        ) ON COMMIT DROP
                    """))
                    
                    # Bulk insert into temp table
                    df.to_sql('temp_catchup_ticks', conn, if_exists='append', index=False, method='multi')
                    
                    # Upsert from temp table to main table
                    result = conn.execute(text("""
                        INSERT INTO forex_ticks (time, symbol, bid, ask, bid_size, ask_size, source)
                        SELECT time, symbol, bid, ask, bid_size, ask_size, source 
                        FROM temp_catchup_ticks
                        ON CONFLICT (symbol, time) 
                        DO UPDATE SET 
                            bid = EXCLUDED.bid,
                            ask = EXCLUDED.ask,
                            bid_size = EXCLUDED.bid_size,
                            ask_size = EXCLUDED.ask_size,
                            source = EXCLUDED.source
                        RETURNING 1
                    """))
                    
                    inserted_count = result.rowcount
                    stats['ticks_inserted'] = inserted_count
                    
                    self.logger.info(f"Inserted {inserted_count} ticks into database")
                    
                    # Trigger cascade refresh after catchup
                    conn.execute(text("""
                        SELECT cascade_forex_aggregate_refresh(:symbol, :start_time::timestamptz)
                    """), {'symbol': symbol, 'start_time': from_time})
                    
                    self.logger.info(f"Triggered cascade refresh for {symbol}")
                    
            except Exception as e:
                self.logger.error(f"Failed to insert ticks: {e}")
                raise
        else:
            self.logger.warning(f"No ticks found for catchup period")
        
        return stats

def main():
    parser = argparse.ArgumentParser(
        description='Catchup historical data gaps for forex pairs'
    )
    parser.add_argument(
        '--symbol', 
        required=True,
        help='Symbol to catch up (e.g., EURUSD)'
    )
    parser.add_argument(
        '--from',
        dest='from_time',
        required=True,
        help='Start time in ISO format (e.g., 2024-01-15T10:30:00Z)'
    )
    parser.add_argument(
        '--to',
        dest='to_time',
        required=False,
        help='End time in ISO format (defaults to now)'
    )
    parser.add_argument(
        '--db-url',
        help='Database URL (defaults to DATABASE_URL env var)'
    )
    
    args = parser.parse_args()
    
    # Parse times
    try:
        from_time = datetime.fromisoformat(args.from_time.replace('Z', '+00:00'))
    except ValueError:
        logger.error(f"Invalid from time format: {args.from_time}")
        sys.exit(1)
    
    if args.to_time:
        try:
            to_time = datetime.fromisoformat(args.to_time.replace('Z', '+00:00'))
        except ValueError:
            logger.error(f"Invalid to time format: {args.to_time}")
            sys.exit(1)
    else:
        to_time = datetime.now(datetime.timezone.utc)
    
    # Create ingester and run catchup
    ingester = CatchupIngester(args.db_url)
    
    try:
        stats = ingester.catchup_gap(args.symbol, from_time, to_time)
        print(f"Catchup complete: {stats['ticks_inserted']} ticks inserted, {stats['hours_processed']} hours processed")
    except Exception as e:
        logger.error(f"Catchup failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()