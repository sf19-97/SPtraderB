"""
CSV to Parquet converter for efficient test data storage
"""
import pandas as pd
import sys
import os
from pathlib import Path
from typing import Optional


def convert_csv_to_parquet(
    csv_path: str, 
    parquet_path: Optional[str] = None,
    compression: str = 'snappy'
) -> str:
    """
    Convert CSV file to Parquet format
    
    Args:
        csv_path: Path to input CSV file
        parquet_path: Optional output path (defaults to same name with .parquet extension)
        compression: Compression algorithm ('snappy', 'gzip', 'brotli', None)
        
    Returns:
        Path to created parquet file
    """
    csv_path = Path(csv_path)
    
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")
    
    # Default output path
    if parquet_path is None:
        parquet_path = csv_path.with_suffix('.parquet')
    else:
        parquet_path = Path(parquet_path)
    
    print(f"Reading CSV file: {csv_path}")
    
    # Read CSV with proper types
    df = pd.read_csv(
        csv_path,
        parse_dates=['time'],
        index_col='time',
        dtype={
            'open': 'float64',
            'high': 'float64',
            'low': 'float64',
            'close': 'float64',
            'volume': 'int64'
        }
    )
    
    print(f"Loaded {len(df)} rows")
    print(f"Date range: {df.index[0]} to {df.index[-1]}")
    
    # Save as parquet
    df.to_parquet(
        parquet_path,
        compression=compression,
        engine='pyarrow'
    )
    
    # Calculate compression ratio
    csv_size = csv_path.stat().st_size / 1024 / 1024  # MB
    parquet_size = parquet_path.stat().st_size / 1024 / 1024  # MB
    compression_ratio = csv_size / parquet_size
    
    print(f"Saved to: {parquet_path}")
    print(f"CSV size: {csv_size:.2f} MB")
    print(f"Parquet size: {parquet_size:.2f} MB")
    print(f"Compression ratio: {compression_ratio:.2f}x")
    
    return str(parquet_path)


def batch_convert_directory(directory: str = '.', compression: str = 'snappy'):
    """
    Convert all CSV files in a directory to Parquet
    
    Args:
        directory: Directory containing CSV files
        compression: Compression algorithm
    """
    directory = Path(directory)
    csv_files = list(directory.glob('*.csv'))
    
    if not csv_files:
        print(f"No CSV files found in {directory}")
        return
    
    print(f"Found {len(csv_files)} CSV files to convert")
    
    for csv_path in csv_files:
        try:
            print(f"\nConverting {csv_path.name}...")
            convert_csv_to_parquet(csv_path, compression=compression)
        except Exception as e:
            print(f"Error converting {csv_path.name}: {e}")


def main():
    """Command line interface"""
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python csv_to_parquet.py <csv_file> [output_file]")
        print("  python csv_to_parquet.py --batch [directory]")
        print()
        print("Examples:")
        print("  python csv_to_parquet.py eurusd_1h_2024.csv")
        print("  python csv_to_parquet.py data.csv compressed_data.parquet")
        print("  python csv_to_parquet.py --batch ../data/")
        sys.exit(1)
    
    if sys.argv[1] == '--batch':
        # Batch conversion mode
        directory = sys.argv[2] if len(sys.argv) > 2 else '.'
        batch_convert_directory(directory)
    else:
        # Single file conversion
        csv_path = sys.argv[1]
        parquet_path = sys.argv[2] if len(sys.argv) > 2 else None
        
        try:
            output_path = convert_csv_to_parquet(csv_path, parquet_path)
            print(f"\nConversion complete: {output_path}")
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()