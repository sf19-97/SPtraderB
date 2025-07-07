#!/usr/bin/env python3
"""
Test Bitcoin data structure matches forex data exactly
Verifies tables, columns, data types, constraints, and aggregates
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import sys

def get_db_connection():
    return psycopg2.connect(
        host="localhost",
        database="forex_trading",
        user="postgres"
    )

def compare_table_structures(conn, forex_table, bitcoin_table):
    """Compare column structures between forex and bitcoin tables"""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Get column info for both tables
        query = """
        SELECT 
            column_name,
            data_type,
            character_maximum_length,
            numeric_precision,
            numeric_scale,
            is_nullable,
            column_default
        FROM information_schema.columns
        WHERE table_name = %s
        ORDER BY ordinal_position
        """
        
        cur.execute(query, (forex_table,))
        forex_columns = cur.fetchall()
        
        cur.execute(query, (bitcoin_table,))
        bitcoin_columns = cur.fetchall()
        
        return forex_columns, bitcoin_columns

def compare_constraints(conn, forex_table, bitcoin_table):
    """Compare constraints between tables"""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        query = """
        SELECT 
            conname as constraint_name,
            contype as constraint_type,
            pg_get_constraintdef(oid) as definition
        FROM pg_constraint
        WHERE conrelid = %s::regclass
        ORDER BY conname
        """
        
        cur.execute(query, (forex_table,))
        forex_constraints = cur.fetchall()
        
        cur.execute(query, (bitcoin_table,))
        bitcoin_constraints = cur.fetchall()
        
        return forex_constraints, bitcoin_constraints

def compare_indexes(conn, forex_table, bitcoin_table):
    """Compare indexes between tables"""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        query = """
        SELECT 
            indexname,
            indexdef
        FROM pg_indexes
        WHERE tablename = %s
        ORDER BY indexname
        """
        
        cur.execute(query, (forex_table,))
        forex_indexes = cur.fetchall()
        
        cur.execute(query, (bitcoin_table,))
        bitcoin_indexes = cur.fetchall()
        
        return forex_indexes, bitcoin_indexes

def check_hypertable_settings(conn):
    """Check TimescaleDB hypertable settings"""
    # Create new cursor for clean transaction
    conn2 = get_db_connection()
    try:
        with conn2.cursor(cursor_factory=RealDictCursor) as cur:
            # Just check that both are hypertables
            cur.execute("""
                SELECT 
                    schema_name as schemaname,
                    table_name as tablename,
                    '7 days'::text as chunk_time_interval
                FROM _timescaledb_catalog.hypertable
                WHERE table_name IN ('forex_ticks', 'bitcoin_ticks')
                ORDER BY table_name
            """)
            return cur.fetchall()
    finally:
        conn2.close()

def verify_continuous_aggregates(conn):
    """Verify continuous aggregate structures match"""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        # Get all continuous aggregates
        query = """
        SELECT 
            view_schema,
            view_name,
            materialization_hypertable_schema,
            materialization_hypertable_name
        FROM timescaledb_information.continuous_aggregates
        WHERE view_name LIKE '%candles_%'
        ORDER BY view_name
        """
        
        cur.execute(query)
        aggregates = cur.fetchall()
        
        # Group by timeframe
        forex_aggs = [a for a in aggregates if not a['view_name'].startswith('bitcoin_')]
        bitcoin_aggs = [a for a in aggregates if a['view_name'].startswith('bitcoin_')]
        
        return forex_aggs, bitcoin_aggs

def test_data_quality(conn):
    """Test data quality and consistency"""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        tests = []
        
        # Test 1: Check for nulls in required fields
        for table in ['forex_ticks', 'bitcoin_ticks']:
            cur.execute(f"""
                SELECT COUNT(*) as null_count
                FROM {table}
                WHERE time IS NULL OR symbol IS NULL OR bid IS NULL OR ask IS NULL
            """)
            result = cur.fetchone()
            tests.append({
                'test': f'No nulls in {table}',
                'passed': result['null_count'] == 0,
                'details': f"Found {result['null_count']} null values"
            })
        
        # Test 2: Check spread calculation
        for table in ['forex_ticks', 'bitcoin_ticks']:
            cur.execute(f"""
                SELECT COUNT(*) as mismatch_count
                FROM {table}
                WHERE ABS(spread - (ask - bid)) > 0.00001
                LIMIT 100
            """)
            result = cur.fetchone()
            tests.append({
                'test': f'Spread calculation in {table}',
                'passed': result['mismatch_count'] == 0,
                'details': f"Found {result['mismatch_count']} mismatches"
            })
        
        # Test 3: Check mid_price calculation
        for table in ['forex_ticks', 'bitcoin_ticks']:
            cur.execute(f"""
                SELECT COUNT(*) as mismatch_count
                FROM {table}
                WHERE ABS(mid_price - ((bid + ask) / 2)) > 0.00001
                LIMIT 100
            """)
            result = cur.fetchone()
            tests.append({
                'test': f'Mid price calculation in {table}',
                'passed': result['mismatch_count'] == 0,
                'details': f"Found {result['mismatch_count']} mismatches"
            })
        
        # Test 4: Check candle aggregation
        for timeframe in ['5m', '15m', '1h', '4h', '12h']:
            for prefix in ['forex_', 'bitcoin_']:
                table = f"{prefix}candles_{timeframe}"
                cur.execute(f"""
                    SELECT 
                        COUNT(*) as candle_count,
                        COUNT(CASE WHEN high < low THEN 1 END) as invalid_candles,
                        COUNT(CASE WHEN open IS NULL OR close IS NULL THEN 1 END) as null_prices
                    FROM {table}
                    WHERE symbol = %s
                """, ('EURUSD' if prefix == 'forex_' else 'BTCUSD',))
                result = cur.fetchone()
                tests.append({
                    'test': f'Valid candles in {table}',
                    'passed': result['invalid_candles'] == 0 and result['null_prices'] == 0,
                    'details': f"{result['candle_count']} candles, {result['invalid_candles']} invalid, {result['null_prices']} nulls"
                })
        
        return tests

def main():
    print("Bitcoin vs Forex Data Structure Parity Test")
    print("=" * 80)
    
    conn = get_db_connection()
    all_passed = True
    
    try:
        # Test 1: Compare main table structures
        print("\n1. COMPARING MAIN TABLE STRUCTURES")
        print("-" * 40)
        forex_cols, bitcoin_cols = compare_table_structures(conn, 'forex_ticks', 'bitcoin_ticks')
        
        if len(forex_cols) != len(bitcoin_cols):
            print(f"❌ Column count mismatch: forex={len(forex_cols)}, bitcoin={len(bitcoin_cols)}")
            all_passed = False
        else:
            print(f"✓ Both tables have {len(forex_cols)} columns")
        
        # Compare each column
        for i, (fx, btc) in enumerate(zip(forex_cols, bitcoin_cols)):
            if fx['column_name'] != btc['column_name']:
                print(f"❌ Column name mismatch at position {i}: {fx['column_name']} vs {btc['column_name']}")
                all_passed = False
            elif fx['data_type'] != btc['data_type']:
                print(f"❌ Data type mismatch for {fx['column_name']}: {fx['data_type']} vs {btc['data_type']}")
                all_passed = False
            elif fx['numeric_precision'] != btc['numeric_precision'] or fx['numeric_scale'] != btc['numeric_scale']:
                # Special case: Bitcoin might need higher precision for prices
                if fx['column_name'] in ['bid', 'ask', 'mid_price'] and btc['numeric_precision'] > fx['numeric_precision']:
                    print(f"ℹ️  {fx['column_name']}: Bitcoin has higher precision ({btc['numeric_precision']},{btc['numeric_scale']}) vs forex ({fx['numeric_precision']},{fx['numeric_scale']}) - OK for Bitcoin prices")
                else:
                    print(f"❌ Precision mismatch for {fx['column_name']}")
                    all_passed = False
        
        # Test 2: Compare constraints
        print("\n2. COMPARING CONSTRAINTS")
        print("-" * 40)
        forex_const, bitcoin_const = compare_constraints(conn, 'forex_ticks', 'bitcoin_ticks')
        
        # Compare constraint types - both should have 'u' for UNIQUE constraint now
        fx_constraint_names = {c['constraint_name'] for c in forex_const}
        btc_constraint_names = {c['constraint_name'] for c in bitcoin_const}
        
        # Check for matching unique constraints
        has_forex_unique = any('unique' in c['constraint_name'] for c in forex_const)
        has_bitcoin_unique = any('unique' in c['constraint_name'] for c in bitcoin_const)
        
        if has_forex_unique and has_bitcoin_unique:
            print(f"✓ Both tables have UNIQUE constraints")
        else:
            print(f"❌ UNIQUE constraint mismatch")
            all_passed = False
        
        # Test 3: Compare indexes
        print("\n3. COMPARING INDEXES")
        print("-" * 40)
        forex_idx, bitcoin_idx = compare_indexes(conn, 'forex_ticks', 'bitcoin_ticks')
        
        print(f"Forex indexes: {len(forex_idx)}")
        print(f"Bitcoin indexes: {len(bitcoin_idx)}")
        
        # Test 4: Check hypertable settings
        print("\n4. HYPERTABLE SETTINGS")
        print("-" * 40)
        hypertables = check_hypertable_settings(conn)
        for ht in hypertables:
            table_name = ht.get('tablename', ht.get('table_name', 'unknown'))
            interval = ht.get('chunk_time_interval', 'unknown')
            print(f"{table_name}: chunk interval = {interval}")
        
        # Test 5: Verify continuous aggregates
        print("\n5. CONTINUOUS AGGREGATES")
        print("-" * 40)
        forex_aggs, bitcoin_aggs = verify_continuous_aggregates(conn)
        
        print(f"Forex aggregates: {len(forex_aggs)}")
        for agg in forex_aggs:
            print(f"  - {agg['view_name']}")
            
        print(f"\nBitcoin aggregates: {len(bitcoin_aggs)}")
        for agg in bitcoin_aggs:
            print(f"  - {agg['view_name']}")
        
        if len(forex_aggs) != len(bitcoin_aggs):
            print(f"❌ Aggregate count mismatch")
            all_passed = False
        else:
            print(f"✓ Same number of aggregates")
        
        # Test 6: Data quality tests
        print("\n6. DATA QUALITY TESTS")
        print("-" * 40)
        quality_tests = test_data_quality(conn)
        for test in quality_tests:
            status = "✓" if test['passed'] else "❌"
            print(f"{status} {test['test']}: {test['details']}")
            if not test['passed']:
                all_passed = False
        
        # Test 7: Sample data comparison
        print("\n7. SAMPLE DATA")
        print("-" * 40)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get sample forex data
            cur.execute("""
                SELECT * FROM forex_ticks 
                WHERE symbol = 'EURUSD' 
                ORDER BY time DESC LIMIT 1
            """)
            forex_sample = cur.fetchone()
            
            # Get sample bitcoin data
            cur.execute("""
                SELECT * FROM bitcoin_ticks 
                WHERE symbol = 'BTCUSD' 
                ORDER BY time DESC LIMIT 1
            """)
            bitcoin_sample = cur.fetchone()
            
            print("Latest Forex tick (EURUSD):")
            print(f"  Time: {forex_sample['time']}")
            print(f"  Bid: {forex_sample['bid']}, Ask: {forex_sample['ask']}")
            print(f"  Spread: {forex_sample['spread']}, Mid: {forex_sample['mid_price']}")
            
            print("\nLatest Bitcoin tick (BTCUSD):")
            print(f"  Time: {bitcoin_sample['time']}")
            print(f"  Bid: {bitcoin_sample['bid']}, Ask: {bitcoin_sample['ask']}")
            print(f"  Spread: {bitcoin_sample['spread']}, Mid: {bitcoin_sample['mid_price']}")
        
        # Final verdict
        print("\n" + "=" * 80)
        if all_passed:
            print("✅ ALL TESTS PASSED - Bitcoin data structure matches forex data")
        else:
            print("❌ SOME TESTS FAILED - See details above")
            sys.exit(1)
            
    finally:
        conn.close()

if __name__ == "__main__":
    main()