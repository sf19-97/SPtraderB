#!/usr/bin/env python3
"""
Direct Bitcoin ingestion from Kraken WebSocket to PostgreSQL
No Pulsar, no Docker, just Python -> PostgreSQL
Automatically restarts on failure
"""
import asyncio
import json
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime, timezone
import websockets
import logging
import signal
import sys
from typing import Optional, List, Tuple

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class DirectBitcoinIngester:
    def __init__(self, db_config):
        self.db_config = db_config
        self.conn = None
        self.cursor = None
        self.should_run = True
        self.ws = None
        self.reconnect_delay = 5
        self.batch = []
        self.batch_size = 100
        self.last_flush = datetime.now()
        self.flush_interval = 5  # seconds
        
    def connect_db(self):
        """Connect to PostgreSQL"""
        try:
            # Close existing connection and cursor
            if self.cursor:
                self.cursor.close()
                self.cursor = None
            if self.conn:
                self.conn.close()
                self.conn = None
                
            # Create new connection
            self.conn = psycopg2.connect(**self.db_config)
            self.conn.autocommit = False
            self.cursor = self.conn.cursor()
            logger.info("Connected to PostgreSQL")
            return True
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            self.cursor = None
            self.conn = None
            return False
    
    def flush_batch(self):
        """Write batch to database"""
        if not self.batch:
            return
        
        # Ensure we have a valid connection
        if not self.cursor or not self.conn:
            logger.warning("No database connection, attempting to reconnect...")
            if not self.connect_db():
                logger.error("Failed to reconnect to database, dropping batch")
                self.batch = []
                return
            
        try:
            # Insert ticks
            execute_values(
                self.cursor,
                """
                INSERT INTO bitcoin_ticks (time, symbol, bid, ask)
                VALUES %s
                ON CONFLICT (time, symbol) DO NOTHING
                """,
                self.batch,
                template="(%s, %s, %s, %s)"
            )
            self.conn.commit()
            logger.info(f"Flushed {len(self.batch)} ticks to database")
            self.batch = []
            self.last_flush = datetime.now()
            
        except Exception as e:
            logger.error(f"Failed to flush batch: {e}")
            try:
                self.conn.rollback()
            except:
                pass  # Connection might be dead
            
            # Try to reconnect for next batch
            self.connect_db()
            # Keep the batch to retry on next flush
            logger.info(f"Keeping {len(self.batch)} ticks to retry later")
    
    async def process_ticker(self, data):
        """Process Kraken ticker data"""
        tick_data = data[1]
        
        # Extract bid/ask
        bid = float(tick_data['b'][0])  # Best bid price
        ask = float(tick_data['a'][0])  # Best ask price
        last = float(tick_data['c'][0])  # Last trade price
        volume = float(tick_data['v'][0])  # Volume today
        
        timestamp = datetime.now(timezone.utc)
        
        # Add to batch
        self.batch.append((
            timestamp,
            'BTCUSD',
            bid,
            ask
        ))
        
        # Flush if batch is full or time elapsed
        if len(self.batch) >= self.batch_size or \
           (datetime.now() - self.last_flush).seconds >= self.flush_interval:
            self.flush_batch()
    
    async def connect_websocket(self):
        """Connect to Kraken WebSocket"""
        url = "wss://ws.kraken.com"
        
        while self.should_run:
            try:
                logger.info("Connecting to Kraken WebSocket...")
                async with websockets.connect(url) as ws:
                    self.ws = ws
                    logger.info("Connected to Kraken")
                    
                    # Subscribe to BTC/USD ticker
                    subscribe_msg = {
                        "event": "subscribe",
                        "pair": ["XBT/USD"],
                        "subscription": {"name": "ticker"}
                    }
                    await ws.send(json.dumps(subscribe_msg))
                    
                    # Reset reconnect delay on successful connection
                    self.reconnect_delay = 5
                    
                    # Process messages
                    async for message in ws:
                        if not self.should_run:
                            break
                            
                        data = json.loads(message)
                        
                        # Skip non-data messages
                        if isinstance(data, dict):
                            if data.get('event') == 'heartbeat':
                                logger.debug("Heartbeat")
                            elif data.get('event') == 'systemStatus':
                                logger.info(f"System status: {data}")
                            elif data.get('event') == 'subscriptionStatus':
                                logger.info(f"Subscription: {data}")
                            continue
                        
                        # Process ticker data
                        if isinstance(data, list) and len(data) == 4:
                            channel_name = data[2]
                            if channel_name == 'ticker':
                                await self.process_ticker(data)
                                
            except websockets.exceptions.ConnectionClosed:
                logger.warning("WebSocket connection closed")
            except Exception as e:
                logger.error(f"WebSocket error: {e}")
            
            if self.should_run:
                logger.info(f"Reconnecting in {self.reconnect_delay} seconds...")
                await asyncio.sleep(self.reconnect_delay)
                self.reconnect_delay = min(self.reconnect_delay * 2, 60)
    
    def signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logger.info("Shutdown signal received")
        self.should_run = False
        if self.ws:
            asyncio.create_task(self.ws.close())
    
    async def run(self):
        """Main run loop"""
        # Set up signal handlers
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)
        
        # Connect to database
        if not self.connect_db():
            logger.error("Failed to connect to database")
            return
        
        try:
            # Run WebSocket connection
            await self.connect_websocket()
        finally:
            # Final flush
            self.flush_batch()
            if self.conn:
                self.conn.close()
            logger.info("Ingester stopped")

def main():
    # Database configuration
    db_config = {
        'host': 'localhost',
        'database': 'forex_trading',
        'user': 'postgres',
        'password': None
    }
    
    # Create and run ingester
    ingester = DirectBitcoinIngester(db_config)
    
    # Run event loop
    try:
        asyncio.run(ingester.run())
    except KeyboardInterrupt:
        logger.info("Interrupted by user")

if __name__ == "__main__":
    main()