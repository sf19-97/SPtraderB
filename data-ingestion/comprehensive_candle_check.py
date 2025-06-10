"""
Comprehensive candle alignment check across multiple dates and timeframes.
This script performs a thorough analysis of candle data consistency.
"""

import pandas as pd
from sqlalchemy import create_engine
from datetime import datetime, timedelta
import logging
from typing import Dict, List, Tuple

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class CandleAlignmentChecker:
    def __init__(self, db_url: str):
        self.engine = create_engine(db_url)
        self.results = {
            'total_checks': 0,
            'passed_checks': 0,
            'failed_checks': 0,
            'issues_by_type': {},
            'dates_checked': []
        }
    
    def get_available_timeframes(self) -> List[str]:
        """Get list of available candle timeframes from database."""
        query = """
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
            AND table_name LIKE 'forex_candles_%'
        ORDER BY table_name
        """
        result = pd.read_sql(query, self.engine)
        timeframes = []
        for table in result['table_name']:
            # Extract timeframe from table name (e.g., forex_candles_1h -> 1h)
            parts = table.split('_')
            if len(parts) >= 3:
                timeframes.append(parts[2])
        return timeframes
    
    def get_date_range(self, symbol: str = 'EURUSD') -> Tuple[datetime, datetime]:
        """Get the date range of available data."""
        query = """
        SELECT 
            MIN(DATE(time)) as min_date,
            MAX(DATE(time)) as max_date
        FROM forex_candles_1h
        WHERE symbol = %s
        """
        result = pd.read_sql(query, self.engine, params=(symbol,))
        if result.empty or result['min_date'][0] is None:
            raise ValueError(f"No data found for symbol {symbol}")
        return result['min_date'][0], result['max_date'][0]
    
    def check_timeframe_alignment(self, symbol: str, date: datetime.date, 
                                smaller_tf: str, larger_tf: str) -> List[Dict]:
        """Check alignment between two timeframes."""
        issues = []
        
        # Parse timeframe strings to get hours
        def parse_timeframe(tf: str) -> int:
            if tf.endswith('m'):
                return int(tf[:-1]) / 60
            elif tf.endswith('h'):
                return int(tf[:-1])
            else:
                raise ValueError(f"Unknown timeframe format: {tf}")
        
        smaller_hours = parse_timeframe(smaller_tf)
        larger_hours = parse_timeframe(larger_tf)
        
        if larger_hours % smaller_hours != 0:
            logger.warning(f"Timeframes {smaller_tf} and {larger_tf} don't align evenly")
            return issues
        
        candles_per_period = int(larger_hours / smaller_hours)
        
        # Get candles for both timeframes
        query_template = """
        SELECT time, symbol, open, high, low, close, volume
        FROM forex_candles_{tf}
        WHERE symbol = %s AND DATE(time) = %s
        ORDER BY time
        """
        
        df_smaller = pd.read_sql(
            query_template.format(tf=smaller_tf), 
            self.engine, 
            params=(symbol, date)
        )
        df_larger = pd.read_sql(
            query_template.format(tf=larger_tf), 
            self.engine, 
            params=(symbol, date)
        )
        
        if df_smaller.empty or df_larger.empty:
            return issues
        
        # Check each larger timeframe candle
        for _, large_candle in df_larger.iterrows():
            period_start = large_candle['time']
            period_end = period_start + timedelta(hours=larger_hours)
            
            # Find corresponding smaller candles
            mask = (df_smaller['time'] >= period_start) & (df_smaller['time'] < period_end)
            small_candles = df_smaller[mask]
            
            if len(small_candles) == 0:
                issues.append({
                    'type': 'missing_candles',
                    'timeframes': f"{smaller_tf}->{larger_tf}",
                    'time': period_start,
                    'issue': f"No {smaller_tf} candles found for {larger_tf} period"
                })
                continue
            
            if len(small_candles) != candles_per_period:
                issues.append({
                    'type': 'incorrect_count',
                    'timeframes': f"{smaller_tf}->{larger_tf}",
                    'time': period_start,
                    'issue': f"Expected {candles_per_period} {smaller_tf} candles, found {len(small_candles)}"
                })
            
            # Check OHLC alignment
            if len(small_candles) > 0:
                # Open should match first candle
                if abs(large_candle['open'] - small_candles.iloc[0]['open']) > 0.00001:
                    issues.append({
                        'type': 'open_mismatch',
                        'timeframes': f"{smaller_tf}->{larger_tf}",
                        'time': period_start,
                        'issue': f"Open mismatch: {large_candle['open']} vs {small_candles.iloc[0]['open']}"
                    })
                
                # Close should match last candle
                if abs(large_candle['close'] - small_candles.iloc[-1]['close']) > 0.00001:
                    issues.append({
                        'type': 'close_mismatch',
                        'timeframes': f"{smaller_tf}->{larger_tf}",
                        'time': period_start,
                        'issue': f"Close mismatch: {large_candle['close']} vs {small_candles.iloc[-1]['close']}"
                    })
                
                # High should be max of all highs
                max_high = small_candles['high'].max()
                if abs(large_candle['high'] - max_high) > 0.00001:
                    issues.append({
                        'type': 'high_mismatch',
                        'timeframes': f"{smaller_tf}->{larger_tf}",
                        'time': period_start,
                        'issue': f"High mismatch: {large_candle['high']} vs {max_high}"
                    })
                
                # Low should be min of all lows
                min_low = small_candles['low'].min()
                if abs(large_candle['low'] - min_low) > 0.00001:
                    issues.append({
                        'type': 'low_mismatch',
                        'timeframes': f"{smaller_tf}->{larger_tf}",
                        'time': period_start,
                        'issue': f"Low mismatch: {large_candle['low']} vs {min_low}"
                    })
                
                # Volume should be sum
                sum_volume = small_candles['volume'].sum()
                if abs(large_candle['volume'] - sum_volume) > 1:
                    issues.append({
                        'type': 'volume_mismatch',
                        'timeframes': f"{smaller_tf}->{larger_tf}",
                        'time': period_start,
                        'issue': f"Volume mismatch: {large_candle['volume']} vs {sum_volume}"
                    })
        
        return issues
    
    def check_boundary_times(self, symbol: str, date: datetime.date) -> List[Dict]:
        """Check if candles start at expected boundary times."""
        issues = []
        
        # Define expected start times for each timeframe
        expected_boundaries = {
            '1h': list(range(24)),  # Every hour
            '4h': [0, 4, 8, 12, 16, 20],  # Every 4 hours
            '1d': [0],  # Midnight only
        }
        
        for tf, expected_hours in expected_boundaries.items():
            query = f"""
            SELECT time, symbol
            FROM forex_candles_{tf}
            WHERE symbol = %s AND DATE(time) = %s
            ORDER BY time
            """
            
            try:
                df = pd.read_sql(query, self.engine, params=(symbol, date))
                
                for _, row in df.iterrows():
                    hour = row['time'].hour
                    if hour not in expected_hours:
                        issues.append({
                            'type': 'boundary_time',
                            'timeframe': tf,
                            'time': row['time'],
                            'issue': f"{tf} candle at unexpected hour {hour}:00"
                        })
            except Exception as e:
                logger.warning(f"Could not check {tf} boundaries: {e}")
        
        return issues
    
    def run_comprehensive_check(self, symbol: str = 'EURUSD', 
                              sample_dates: int = 5) -> Dict:
        """Run comprehensive alignment check across multiple dates."""
        logger.info(f"Starting comprehensive candle alignment check for {symbol}")
        
        # Get available data range
        try:
            min_date, max_date = self.get_date_range(symbol)
        except ValueError as e:
            logger.error(str(e))
            return self.results
        
        logger.info(f"Data available from {min_date} to {max_date}")
        
        # Sample dates evenly across the range
        total_days = (max_date - min_date).days
        if total_days <= sample_dates:
            dates_to_check = pd.date_range(min_date, max_date, freq='D')
        else:
            dates_to_check = pd.date_range(min_date, max_date, periods=sample_dates)
        
        # Check each date
        for check_date in dates_to_check:
            date = check_date.date()
            logger.info(f"\nChecking date: {date}")
            self.results['dates_checked'].append(date)
            
            # Check 1h -> 4h alignment
            issues_1h_4h = self.check_timeframe_alignment(symbol, date, '1h', '4h')
            self.results['total_checks'] += 1
            if not issues_1h_4h:
                self.results['passed_checks'] += 1
                logger.info("✅ 1h -> 4h alignment: PASSED")
            else:
                self.results['failed_checks'] += 1
                logger.warning(f"❌ 1h -> 4h alignment: FAILED ({len(issues_1h_4h)} issues)")
            
            # Check boundary times
            boundary_issues = self.check_boundary_times(symbol, date)
            self.results['total_checks'] += 1
            if not boundary_issues:
                self.results['passed_checks'] += 1
                logger.info("✅ Boundary times: PASSED")
            else:
                self.results['failed_checks'] += 1
                logger.warning(f"❌ Boundary times: FAILED ({len(boundary_issues)} issues)")
            
            # Aggregate issues
            all_issues = issues_1h_4h + boundary_issues
            for issue in all_issues:
                issue_type = issue['type']
                if issue_type not in self.results['issues_by_type']:
                    self.results['issues_by_type'][issue_type] = 0
                self.results['issues_by_type'][issue_type] += 1
        
        # Print summary
        self.print_summary()
        return self.results
    
    def print_summary(self):
        """Print a comprehensive summary of the check results."""
        logger.info("\n" + "="*60)
        logger.info("COMPREHENSIVE CANDLE ALIGNMENT CHECK SUMMARY")
        logger.info("="*60)
        
        logger.info(f"\nDates checked: {len(self.results['dates_checked'])}")
        logger.info(f"Total checks performed: {self.results['total_checks']}")
        logger.info(f"Passed: {self.results['passed_checks']} ({self.results['passed_checks']/max(1, self.results['total_checks'])*100:.1f}%)")
        logger.info(f"Failed: {self.results['failed_checks']} ({self.results['failed_checks']/max(1, self.results['total_checks'])*100:.1f}%)")
        
        if self.results['issues_by_type']:
            logger.info("\nIssues by type:")
            for issue_type, count in sorted(self.results['issues_by_type'].items(), 
                                          key=lambda x: x[1], reverse=True):
                logger.info(f"  - {issue_type}: {count} occurrences")
        else:
            logger.info("\n🎉 No issues found! Perfect candle alignment.")
        
        logger.info("\nDates checked:")
        for date in self.results['dates_checked'][:10]:
            logger.info(f"  - {date}")
        if len(self.results['dates_checked']) > 10:
            logger.info(f"  ... and {len(self.results['dates_checked']) - 10} more")

def main():
    # Database connection
    DB_URL = "postgresql://postgres@localhost:5432/forex_trading"
    
    # Create checker and run comprehensive check
    checker = CandleAlignmentChecker(DB_URL)
    
    # Check with default settings (5 sample dates)
    results = checker.run_comprehensive_check()
    
    # Optionally run more thorough check
    # results = checker.run_comprehensive_check(sample_dates=20)

if __name__ == "__main__":
    main()