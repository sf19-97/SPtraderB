#!/usr/bin/env python3
"""
Auto Ingester Monitor - Checks for new Dukascopy data and ingests automatically
SAFE MODE: Use --dry-run to see what would happen without making changes
"""

import yaml
import requests
import psycopg2
from datetime import datetime, timezone, timedelta
import time
import logging
import sys
import os
import subprocess
from pathlib import Path

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('auto_ingester.log')
    ]
)
logger = logging.getLogger(__name__)

class DukascopyAutoIngester:
    def __init__(self, config_path='config.yaml', dry_run=False):
        """Initialize with config file"""
        self.dry_run = dry_run
        if self.dry_run:
            logger.info("🔒 DRY RUN MODE - No changes will be made")
            
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)
        
        self.cloud_url = self.config['cloud_monitor']['url']
        self.db_url = self.config['database']['url']
        self.symbols = self.config['symbols']
        
    def is_market_open(self):
        """Check if forex market is currently open"""
        now = datetime.now(timezone.utc)
        weekday = now.weekday()
        hour = now.hour
        
        # Market opens Sunday 21:00 UTC (weekday=6)
        # Market closes Friday 21:00 UTC (weekday=4)
        
        # Closed all day Saturday (weekday=5)
        if weekday == 5:
            return False
            
        # Closed Sunday before 21:00 UTC
        if weekday == 6 and hour < 21:
            return False
            
        # Closed Friday after 21:00 UTC
        if weekday == 4 and hour >= 21:
            return False
            
        # Open all other times
        return True
        
    def check_cloud_monitor(self):
        """Check what data is available from cloud monitor"""
        try:
            logger.info(f"Checking cloud monitor: {self.cloud_url}")
            response = requests.get(self.cloud_url, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            logger.info(f"Cloud monitor reports data up to: {data['summary']['latest_common_hour']}")
            return data
            
        except Exception as e:
            logger.error(f"Failed to check cloud monitor: {e}")
            return None
    
    def check_local_database(self, symbol):
        """Check what data we have locally for a symbol"""
        try:
            conn = psycopg2.connect(self.db_url)
            cur = conn.cursor()
            
            # Get the latest tick timestamp for this symbol
            cur.execute("""
                SELECT MAX(time) as latest_tick 
                FROM forex_ticks 
                WHERE symbol = %s
            """, (symbol,))
            
            result = cur.fetchone()
            latest_tick = result[0] if result and result[0] else None
            
            cur.close()
            conn.close()
            
            if latest_tick:
                logger.info(f"Local database has {symbol} data up to: {latest_tick}")
            else:
                logger.info(f"No data found for {symbol} in local database")
                
            return latest_tick
            
        except Exception as e:
            logger.error(f"Failed to check local database: {e}")
            return None
    
    def get_last_market_close(self):
        """Get the last time the market was open"""
        now = datetime.now(timezone.utc)
        
        # If market is currently open, return now
        if self.is_market_open():
            return now
            
        # Otherwise, find the last Friday 21:00 UTC
        days_back = 0
        while days_back < 7:
            check_time = now - timedelta(days=days_back)
            if check_time.weekday() == 4:  # Friday
                # Return Friday 21:00 UTC
                return check_time.replace(hour=21, minute=0, second=0, microsecond=0)
            days_back += 1
            
        return now  # Fallback
    
    def needs_ingestion(self, symbol, cloud_latest, local_latest):
        """Determine if we need to ingest data for a symbol"""
        if not cloud_latest:
            return False
            
        # Parse cloud latest time
        cloud_time = datetime.fromisoformat(cloud_latest.replace('Z', '+00:00'))
        
        if not local_latest:
            logger.info(f"✅ {symbol} needs ingestion - no local data")
            return True
            
        # Make sure local_latest is timezone aware
        if local_latest.tzinfo is None:
            local_latest = local_latest.replace(tzinfo=timezone.utc)
            
        # Check if cloud has newer data
        if cloud_time > local_latest:
            # Calculate hours behind based on last market close, not current time
            last_market_close = self.get_last_market_close()
            hours_behind = (cloud_time - local_latest).total_seconds() / 3600
            market_hours_behind = (last_market_close - local_latest).total_seconds() / 3600
            
            # Only log market hours behind to avoid confusion
            logger.info(f"✅ {symbol} needs ingestion - {market_hours_behind:.1f} market hours behind")
            return True
        else:
            logger.info(f"✔️ {symbol} is up to date")
            return False
    
    def run_ingestion(self, symbol, start_date, end_date):
        """Run the dukascopy ingester for a specific symbol and date range"""
        # Find the ingester script
        script_path = Path(__file__).parent.parent / "dukascopy_ingester.py"
        
        if not script_path.exists():
            logger.error(f"Ingester script not found: {script_path}")
            return False
            
        cmd = [
            sys.executable,  # Use same Python interpreter
            str(script_path),
            "--symbol", symbol,
            "--start-date", start_date.strftime("%Y-%m-%d"),
            "--end-date", end_date.strftime("%Y-%m-%d"),
            "--db-url", self.db_url
        ]
        
        logger.info(f"Running command: {' '.join(cmd)}")
        
        if self.dry_run:
            logger.info("🔒 DRY RUN - Would execute above command")
            return True
            
        try:
            # Run the ingester
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info(f"✅ Successfully ingested {symbol} data")
                return True
            else:
                logger.error(f"❌ Ingestion failed for {symbol}: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Failed to run ingester: {e}")
            return False
    
    def monitor_once(self):
        """Run one monitoring cycle"""
        logger.info("=" * 60)
        logger.info("Starting monitoring cycle")
        
        # Check if market is open
        if not self.is_market_open():
            logger.info("🔒 Forex market is closed (weekend). Skipping cycle.")
            return
        
        # Check cloud monitor
        cloud_data = self.check_cloud_monitor()
        if not cloud_data:
            logger.error("Failed to get cloud data, skipping cycle")
            return
            
        # Process each symbol
        for symbol in self.symbols:
            logger.info(f"\nProcessing {symbol}...")
            
            # Get cloud latest
            symbol_data = cloud_data['symbols'].get(symbol, {})
            cloud_latest = symbol_data.get('latest_available')
            
            if not cloud_latest:
                logger.warning(f"No cloud data for {symbol}")
                continue
                
            # Get local latest
            local_latest = self.check_local_database(symbol)
            
            # Check if ingestion needed
            if self.needs_ingestion(symbol, cloud_latest, local_latest):
                # Calculate date range
                cloud_time = datetime.fromisoformat(cloud_latest.replace('Z', '+00:00'))
                
                if local_latest:
                    # Start from day after last data
                    start_date = local_latest.date()
                else:
                    # Start from 30 days ago if no data
                    start_date = (cloud_time - timedelta(days=30)).date()
                
                end_date = cloud_time.date()
                
                # Run ingestion
                self.run_ingestion(symbol, start_date, end_date)
            
            # Small delay between symbols
            time.sleep(1)
        
        logger.info("\nMonitoring cycle complete")
        logger.info("=" * 60)
    
    def run_forever(self):
        """Run monitoring in a loop"""
        logger.info("Starting auto ingester monitor...")
        logger.info(f"Poll interval: {self.config['cloud_monitor']['poll_interval']} seconds")
        
        while True:
            try:
                self.monitor_once()
                
                # Wait for next cycle
                wait_time = self.config['cloud_monitor']['poll_interval']
                logger.info(f"\nSleeping for {wait_time} seconds until next check...")
                time.sleep(wait_time)
                
            except KeyboardInterrupt:
                logger.info("\nShutdown requested by user")
                break
            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                logger.info("Waiting 60 seconds before retry...")
                time.sleep(60)

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Auto ingest Dukascopy data')
    parser.add_argument('--dry-run', action='store_true', 
                       help='Show what would be done without making changes')
    parser.add_argument('--once', action='store_true',
                       help='Run once and exit (don\'t loop)')
    parser.add_argument('--config', default='config.yaml',
                       help='Path to config file')
    
    args = parser.parse_args()
    
    # Create ingester
    ingester = DukascopyAutoIngester(args.config, dry_run=args.dry_run)
    
    if args.once:
        # Run single check
        ingester.monitor_once()
    else:
        # Run forever
        ingester.run_forever()

if __name__ == '__main__':
    main()