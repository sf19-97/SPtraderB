#!/usr/bin/env python3
"""Upload CSV data to TimescaleCloud"""

import psycopg2
import csv
from tqdm import tqdm

# Database connection
DATABASE_URL = "postgres://tsdbadmin:f176m7h5n2q6cv01@dsahkb3sce.sko4l85hee.tsdb.cloud.timescale.com:32588/tsdb?sslmode=require"

# CSV file
CSV_FILE = "data-ingestion/backfill/dukascopy/data/EURUSD_20241023_20250123_ticks.csv"

print("📊 Uploading CSV data to TimescaleCloud...")
print(f"File: {CSV_FILE}")

# Connect to database
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

# First, clear any test data
cur.execute("DELETE FROM forex_ticks WHERE source = 'test';")
conn.commit()

# Read CSV and upload in batches
batch_size = 10000
batch = []
total_rows = 0

with open(CSV_FILE, 'r') as f:
    reader = csv.DictReader(f)

    # Count total rows for progress bar (approximate)
    total_lines = sum(1 for _ in open(CSV_FILE)) - 1  # minus header

    print(f"Total rows to upload: {total_lines:,}")
    print("Uploading...")

    with tqdm(total=total_lines, unit="rows") as pbar:
        for row in reader:
            # Map CSV columns to database columns
            # CSV: time,symbol,ask,bid,ask_size,bid_size
            # DB:  time,symbol,bid,ask,bid_size,ask_size,source
            batch.append((
                row['time'],
                row['symbol'],
                float(row['bid']),      # bid
                float(row['ask']),      # ask
                int(float(row['bid_size'])),  # bid_size
                int(float(row['ask_size'])),  # ask_size
                'dukascopy'             # source
            ))

            if len(batch) >= batch_size:
                # Insert batch
                cur.executemany("""
                    INSERT INTO forex_ticks (time, symbol, bid, ask, bid_size, ask_size, source)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, batch)
                conn.commit()

                total_rows += len(batch)
                pbar.update(len(batch))
                batch = []

        # Insert remaining rows
        if batch:
            cur.executemany("""
                INSERT INTO forex_ticks (time, symbol, bid, ask, bid_size, ask_size, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, batch)
            conn.commit()
            total_rows += len(batch)
            pbar.update(len(batch))

print(f"✅ Uploaded {total_rows:,} rows successfully!")

# Verify the upload
cur.execute("""
    SELECT
        symbol,
        COUNT(*) as tick_count,
        MIN(time) as earliest,
        MAX(time) as latest
    FROM forex_ticks
    WHERE source = 'dukascopy'
    GROUP BY symbol
""")

print("\n📊 Data Summary:")
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]:,} ticks from {row[2]} to {row[3]}")

# Test candle generation
cur.execute("""
    SELECT COUNT(*) FROM (
        SELECT DISTINCT time_bucket('1 minute', time)
        FROM forex_ticks
        WHERE symbol = 'EURUSD'
    ) t
""")
candle_count = cur.fetchone()[0]

print(f"\n🕯️ Can generate {candle_count:,} 1-minute candles")

# Close connection
cur.close()
conn.close()

print("\n✅ TimescaleCloud is ready!")
print("\nTo use with your app:")
print(f'  export DATABASE_URL="{DATABASE_URL}"')
print("  npm run tauri dev")