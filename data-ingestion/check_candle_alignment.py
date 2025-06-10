"""
Script to check alignment between 1h and 4h candles in the forex_trading database.
This verifies that 1h candles properly align with 4h candles at 4-hour boundaries.
"""

import pandas as pd
from sqlalchemy import create_engine
from datetime import datetime, timedelta
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def check_candle_alignment(db_url, symbol='EURUSD', check_date=None):
    """
    Check if 1h candles align properly with 4h candles.
    
    Args:
        db_url: Database connection URL
        symbol: Currency pair symbol to check
        check_date: Specific date to check (default: most recent date with data)
    """
    engine = create_engine(db_url)
    
    # If no date specified, get the most recent date with data
    if check_date is None:
        query = """
        SELECT DATE(time) as date 
        FROM forex_candles_1h 
        WHERE symbol = %s 
        ORDER BY time DESC 
        LIMIT 1
        """
        result = pd.read_sql(query, engine, params=(symbol,))
        if result.empty:
            logger.error("No 1h candle data found in database")
            return
        check_date = result['date'][0]
    
    logger.info(f"Checking candle alignment for {symbol} on {check_date}")
    
    # Get 1h candles for the day
    query_1h = """
    SELECT 
        time,
        symbol,
        open,
        high,
        low,
        close,
        volume
    FROM forex_candles_1h
    WHERE symbol = %s 
        AND DATE(time) = %s
    ORDER BY time
    """
    df_1h = pd.read_sql(query_1h, engine, params=(symbol, check_date))
    
    if df_1h.empty:
        logger.error(f"No 1h candles found for {symbol} on {check_date}")
        return
        
    # Get 4h candles for the day
    query_4h = """
    SELECT 
        time,
        symbol,
        open,
        high,
        low,
        close,
        volume
    FROM forex_candles_4h
    WHERE symbol = %s 
        AND DATE(time) = %s
    ORDER BY time
    """
    df_4h = pd.read_sql(query_4h, engine, params=(symbol, check_date))
    
    if df_4h.empty:
        logger.error(f"No 4h candles found for {symbol} on {check_date}")
        return
    
    logger.info(f"Found {len(df_1h)} 1h candles and {len(df_4h)} 4h candles")
    
    # Check alignment
    misalignments = []
    
    for _, candle_4h in df_4h.iterrows():
        # Get the 4h period boundaries
        period_start = candle_4h['time']
        period_end = period_start + timedelta(hours=4)
        
        # Find all 1h candles within this 4h period
        mask = (df_1h['time'] >= period_start) & (df_1h['time'] < period_end)
        candles_1h_in_period = df_1h[mask]
        
        if candles_1h_in_period.empty:
            misalignments.append({
                'type': 'missing_1h_candles',
                '4h_time': period_start,
                'issue': f"No 1h candles found for 4h period starting at {period_start}"
            })
            continue
        
        # Check if we have exactly 4 1h candles
        if len(candles_1h_in_period) != 4:
            misalignments.append({
                'type': 'incorrect_count',
                '4h_time': period_start,
                'issue': f"Expected 4 1h candles, found {len(candles_1h_in_period)}"
            })
        
        # Check open price alignment (4h open should match first 1h open)
        first_1h = candles_1h_in_period.iloc[0]
        if abs(candle_4h['open'] - first_1h['open']) > 0.00001:  # Allow small floating point differences
            misalignments.append({
                'type': 'open_mismatch',
                '4h_time': period_start,
                'issue': f"4h open ({candle_4h['open']}) != first 1h open ({first_1h['open']})"
            })
        
        # Check close price alignment (4h close should match last 1h close)
        last_1h = candles_1h_in_period.iloc[-1]
        if abs(candle_4h['close'] - last_1h['close']) > 0.00001:
            misalignments.append({
                'type': 'close_mismatch',
                '4h_time': period_start,
                'issue': f"4h close ({candle_4h['close']}) != last 1h close ({last_1h['close']})"
            })
        
        # Check high price (4h high should be max of all 1h highs)
        max_1h_high = candles_1h_in_period['high'].max()
        if abs(candle_4h['high'] - max_1h_high) > 0.00001:
            misalignments.append({
                'type': 'high_mismatch',
                '4h_time': period_start,
                'issue': f"4h high ({candle_4h['high']}) != max 1h high ({max_1h_high})"
            })
        
        # Check low price (4h low should be min of all 1h lows)
        min_1h_low = candles_1h_in_period['low'].min()
        if abs(candle_4h['low'] - min_1h_low) > 0.00001:
            misalignments.append({
                'type': 'low_mismatch',
                '4h_time': period_start,
                'issue': f"4h low ({candle_4h['low']}) != min 1h low ({min_1h_low})"
            })
        
        # Check volume (4h volume should be sum of all 1h volumes)
        sum_1h_volume = candles_1h_in_period['volume'].sum()
        if abs(candle_4h['volume'] - sum_1h_volume) > 1:  # Allow small differences for volume
            misalignments.append({
                'type': 'volume_mismatch',
                '4h_time': period_start,
                'issue': f"4h volume ({candle_4h['volume']}) != sum 1h volume ({sum_1h_volume})"
            })
    
    # Check 4h boundary times (should be at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00)
    expected_hours = [0, 4, 8, 12, 16, 20]
    for _, candle_4h in df_4h.iterrows():
        hour = candle_4h['time'].hour
        if hour not in expected_hours:
            misalignments.append({
                'type': 'boundary_misalignment',
                '4h_time': candle_4h['time'],
                'issue': f"4h candle at unexpected hour: {hour}:00 (expected one of {expected_hours})"
            })
    
    # Report results
    if not misalignments:
        logger.info("✅ Perfect alignment! All 1h and 4h candles are properly aligned.")
    else:
        logger.warning(f"❌ Found {len(misalignments)} alignment issues:")
        
        # Group by type
        issues_by_type = {}
        for issue in misalignments:
            issue_type = issue['type']
            if issue_type not in issues_by_type:
                issues_by_type[issue_type] = []
            issues_by_type[issue_type].append(issue)
        
        for issue_type, issues in issues_by_type.items():
            logger.warning(f"\n{issue_type.upper()} ({len(issues)} occurrences):")
            for issue in issues[:5]:  # Show first 5 examples
                logger.warning(f"  - {issue['issue']}")
            if len(issues) > 5:
                logger.warning(f"  ... and {len(issues) - 5} more")
    
    # Show summary statistics
    logger.info("\n=== SUMMARY ===")
    logger.info(f"Date checked: {check_date}")
    logger.info(f"Symbol: {symbol}")
    logger.info(f"1h candles: {len(df_1h)}")
    logger.info(f"4h candles: {len(df_4h)}")
    logger.info(f"Total issues found: {len(misalignments)}")
    
    # Additional detailed analysis
    if df_1h.shape[0] > 0 and df_4h.shape[0] > 0:
        logger.info("\n=== DETAILED CANDLE INFO ===")
        logger.info("4h Candles:")
        for _, candle in df_4h.iterrows():
            logger.info(f"  {candle['time']}: O={candle['open']:.5f}, H={candle['high']:.5f}, "
                       f"L={candle['low']:.5f}, C={candle['close']:.5f}, V={candle['volume']}")
        
        logger.info("\n1h Candles (first 10):")
        for i, (_, candle) in enumerate(df_1h.iterrows()):
            if i >= 10:
                logger.info(f"  ... and {len(df_1h) - 10} more")
                break
            logger.info(f"  {candle['time']}: O={candle['open']:.5f}, H={candle['high']:.5f}, "
                       f"L={candle['low']:.5f}, C={candle['close']:.5f}, V={candle['volume']}")
    
    return misalignments

def main():
    # Database connection
    DB_URL = "postgresql://postgres@localhost:5432/forex_trading"
    
    # Check alignment for most recent date
    logger.info("Checking candle alignment for most recent data...")
    check_candle_alignment(DB_URL)
    
    # Optionally check a specific date
    # check_candle_alignment(DB_URL, check_date=datetime(2024, 1, 15).date())

if __name__ == "__main__":
    main()