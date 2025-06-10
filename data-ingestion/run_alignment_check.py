#!/usr/bin/env python3
"""
Simple script to run candle alignment checks.
This demonstrates how to use the alignment checking tools.
"""

import sys
from datetime import datetime
import logging

# Import our checking modules
from check_candle_alignment import check_candle_alignment
from comprehensive_candle_check import CandleAlignmentChecker

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def main():
    # Database connection
    DB_URL = "postgresql://postgres@localhost:5432/forex_trading"
    
    if len(sys.argv) > 1 and sys.argv[1] == 'comprehensive':
        # Run comprehensive check
        logger.info("Running comprehensive candle alignment check...")
        logger.info("This will check multiple dates and provide a summary.")
        logger.info("-" * 60)
        
        checker = CandleAlignmentChecker(DB_URL)
        results = checker.run_comprehensive_check(sample_dates=10)
        
    else:
        # Run simple check for most recent date
        logger.info("Running simple candle alignment check for most recent data...")
        logger.info("(Use 'python run_alignment_check.py comprehensive' for full analysis)")
        logger.info("-" * 60)
        
        # Check most recent date
        check_candle_alignment(DB_URL)
        
        # Also check a specific date if you want
        # check_candle_alignment(DB_URL, symbol='EURUSD', check_date=datetime(2024, 1, 15).date())

if __name__ == "__main__":
    main()