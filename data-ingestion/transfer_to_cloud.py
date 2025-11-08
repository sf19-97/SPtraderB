#!/usr/bin/env python3
"""
Transfer local PostgreSQL data to Timescale Cloud
Transfers data in batches with progress tracking
"""
import psycopg2
import os
import io
from tqdm import tqdm

# Source (local)
LOCAL_CONN = "postgresql://postgres@localhost:5432/forex_trading"

# Destination (cloud)
CLOUD_CONN = os.getenv(
    "DATABASE_URL",
    "postgres://tsdbadmin:f176m7h5n2q6cv01@dsahkb3sce.sko4l85hee.tsdb.cloud.timescale.com:32588/tsdb?sslmode=require"
)

BATCH_SIZE = 10000  # Transfer 10k rows at a time

def transfer_table(table_name, columns):
    """Transfer a table from local to cloud"""
    print(f"\n📊 Transferring {table_name}...")

    # Connect to both databases
    local = psycopg2.connect(LOCAL_CONN)
    cloud = psycopg2.connect(CLOUD_CONN)

    local_cur = local.cursor()
    cloud_cur = cloud.cursor()

    # CRITICAL: Disable compression policies temporarily for hypertable
    print("  🔧 Disabling compression and constraints...")
    try:
        # Drop compression policy if exists
        cloud_cur.execute(f"""
            SELECT remove_compression_policy('{table_name}', if_exists => true);
        """)
        # Decompress any compressed chunks
        cloud_cur.execute(f"""
            SELECT decompress_chunk(i, if_compressed => true)
            FROM show_chunks('{table_name}') i;
        """)
        cloud.commit()
    except Exception as e:
        print(f"  ⚠️  Compression handling: {e}")
        cloud.rollback()

    # Get total count
    local_cur.execute(f"SELECT COUNT(*) FROM {table_name}")
    total = local_cur.fetchone()[0]
    print(f"  Total rows: {total:,}")

    if total == 0:
        print("  No data to transfer")
        local.close()
        cloud.close()
        return

    # Stream data in batches using COPY (faster and works with hypertables)
    print("  📤 Starting transfer...")
    local_cur.execute(f"SELECT {columns} FROM {table_name} ORDER BY time")

    transferred = 0
    with tqdm(total=total, unit="rows") as pbar:
        while True:
            rows = local_cur.fetchmany(BATCH_SIZE)
            if not rows:
                break

            # Use COPY for hypertable compatibility (much faster too!)
            csv_buffer = io.StringIO()
            for row in rows:
                csv_buffer.write('\t'.join(str(v) if v is not None else '\\N' for v in row) + '\n')
            csv_buffer.seek(0)

            cloud_cur.copy_from(
                csv_buffer,
                table_name,
                columns=columns.split(', '),
                null='\\N'
            )
            cloud.commit()

            transferred += len(rows)
            pbar.update(len(rows))

    print(f"✅ Transferred {transferred:,} rows")

    local.close()
    cloud.close()

if __name__ == "__main__":
    print("🚀 Starting data transfer to Timescale Cloud...")
    print("📝 Note: spread and mid_price are auto-generated columns, not transferred")

    # Transfer forex_ticks only (spread and mid_price auto-calculated)
    transfer_table(
        "forex_ticks",
        "time, symbol, bid, ask, bid_size, ask_size, source"
    )

    print("\n✨ Transfer complete!")
    print("\n🔄 Next steps:")
    print("1. Refresh continuous aggregates to populate candles:")
    print("   psql \"<cloud-url>\" -c \"CALL refresh_continuous_aggregate('forex_candles_5m', NULL, NULL);\"")
    print("   psql \"<cloud-url>\" -c \"CALL refresh_continuous_aggregate('forex_candles_15m', NULL, NULL);\"")
    print("   psql \"<cloud-url>\" -c \"CALL refresh_continuous_aggregate('forex_candles_1h', NULL, NULL);\"")
    print("\n2. Test your app:")
    print("   npm run tauri dev")
