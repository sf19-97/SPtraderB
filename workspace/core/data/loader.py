"""
Test data loader for indicator development
Supports both parquet files and live data from cache
"""
import os
import pandas as pd
from typing import Optional, List, Dict, Any
from pathlib import Path
import json
import tempfile


def get_data_dir() -> Path:
    """Get the path to the data directory"""
    # Get the workspace root (3 levels up from this file)
    workspace_root = Path(__file__).parent.parent.parent
    data_dir = workspace_root / 'data'
    
    # Create directory if it doesn't exist
    data_dir.mkdir(exist_ok=True)
    
    return data_dir


def list_test_datasets() -> List[Dict[str, Any]]:
    """
    List all available test datasets
    
    Returns:
        List of dataset info dictionaries
    """
    data_dir = get_data_dir()
    datasets = []
    
    # Look for parquet and pickle files
    for file_path in data_dir.glob('*.parquet'):
        try:
            # Quick metadata read without loading full data
            df_meta = pd.read_parquet(file_path, columns=[])
            datasets.append({
                'name': file_path.stem,
                'filename': file_path.name,
                'format': 'parquet',
                'rows': len(df_meta),
                'size_mb': file_path.stat().st_size / 1024 / 1024
            })
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
    
    for file_path in data_dir.glob('*.pkl'):
        try:
            # For pickle, we need to load to get info (but it's fast)
            df = pd.read_pickle(file_path)
            datasets.append({
                'name': file_path.stem,
                'filename': file_path.name,
                'format': 'pickle',
                'rows': len(df),
                'size_mb': file_path.stat().st_size / 1024 / 1024
            })
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
    
    return sorted(datasets, key=lambda x: x['name'])


def load_data_from_env() -> pd.DataFrame:
    """
    Load data based on environment variables set by the IDE
    
    Checks DATA_SOURCE env var:
    - 'live': Load from cache using LIVE_* parameters
    - 'parquet': Load from TEST_DATASET file
    - None: Fall back to load_test_data()
    
    Returns:
        DataFrame with OHLC data
    """
    data_source = os.environ.get('DATA_SOURCE')
    
    # Debug output
    print(f"DATA_SOURCE: {data_source}")
    
    if data_source == 'realtime':
        # For live trading mode, this should connect to a real data feed
        # No mock data allowed
        raise NotImplementedError(
            "Realtime mode requires connection to live data feed. "
            "Use 'live' mode with cached data or 'parquet' mode with test files."
        )
        
    elif data_source == 'live':
        # Load from cached data file
        candle_data_file = os.environ.get('CANDLE_DATA_FILE')
        
        if not candle_data_file:
            raise ValueError(
                "Live mode requires CANDLE_DATA_FILE environment variable. "
                "No mock data will be generated. Ensure the IDE passes real cached data."
            )
        
        print(f"Loading cached data from: {candle_data_file}")
        
        try:
            # Read the JSON file
            with open(candle_data_file, 'r') as f:
                data = json.load(f)
            
            # Convert to DataFrame
            df = pd.DataFrame(data)
            
            # Ensure time column is datetime
            if 'time' in df.columns:
                # Handle both timestamp and ISO string formats
                try:
                    # Try as Unix timestamp first
                    df['time'] = pd.to_datetime(df['time'], unit='s')
                except:
                    # Fall back to ISO string
                    df['time'] = pd.to_datetime(df['time'])
                
                df.set_index('time', inplace=True)
            
            # Log what we loaded
            symbol = os.environ.get('LIVE_SYMBOL', 'UNKNOWN')
            timeframe = os.environ.get('LIVE_TIMEFRAME', 'UNKNOWN')
            print(f"Loaded {len(df)} candles for {symbol} {timeframe}")
            print(f"Date range: {df.index[0]} to {df.index[-1]}")
            
            return df
            
        except FileNotFoundError:
            raise FileNotFoundError(
                f"Candle data file not found: {candle_data_file}. "
                "The IDE must write cached data before running components."
            )
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in candle data file: {e}")
        except Exception as e:
            raise RuntimeError(f"Failed to load candle data: {e}")
            
    elif data_source == 'parquet':
        # Load from parquet file
        dataset = os.environ.get('TEST_DATASET')
        print(f"Using Parquet mode: {dataset if dataset else 'default dataset'}")
        if dataset:
            return load_test_data(dataset)
        else:
            print("No TEST_DATASET specified, loading default")
            return load_test_data()
    
    else:
        # No data source specified, try TEST_DATASET first
        dataset = os.environ.get('TEST_DATASET')
        if dataset:
            return load_test_data(dataset)
        else:
            # Fall back to default behavior
            return load_test_data()


def load_test_data(dataset: Optional[str] = None) -> pd.DataFrame:
    """
    Load test data for indicator development
    
    Args:
        dataset: Name of dataset file (e.g., 'eurusd_1h_2024.parquet')
                If None, loads the default dataset
    
    Returns:
        DataFrame with OHLCV data
    
    Example:
        >>> data = load_test_data('eurusd_1h_2024.parquet')
        >>> data = load_test_data()  # loads default
    """
    data_dir = get_data_dir()
    
    if dataset is None:
        # Try to load default dataset
        default_files = [
            'eurusd_1h_recent.parquet',
            'eurusd_1h_2024.parquet',
            'test_data.parquet',
            'test_data.pkl'
        ]
        
        for default in default_files:
            file_path = data_dir / default
            if file_path.exists():
                dataset = default
                break
        
        if dataset is None:
            # No fallback to mock data
            raise FileNotFoundError(
                "No test data found in workspace/data/. "
                "Export data from the database using the IDE's export feature."
            )
    
    # Load the specified dataset
    file_path = data_dir / dataset
    
    if not file_path.exists():
        available = list_test_datasets()
        if available:
            names = [d['filename'] for d in available]
            raise FileNotFoundError(
                f"Dataset '{dataset}' not found. Available datasets: {names}"
            )
        else:
            raise FileNotFoundError(
                f"Dataset '{dataset}' not found. No mock data will be generated."
            )
    
    # Load based on file extension
    if file_path.suffix == '.parquet':
        df = pd.read_parquet(file_path)
    elif file_path.suffix == '.pkl':
        df = pd.read_pickle(file_path)
    else:
        raise ValueError(f"Unsupported file format: {file_path.suffix}")
    
    # Ensure standard column names
    df.columns = df.columns.str.lower()
    
    # Set time column as index if it exists
    if 'time' in df.columns:
        df['time'] = pd.to_datetime(df['time'])
        df = df.set_index('time')
        df.index.name = None  # Remove index name for cleaner display
    
    # Ensure we have required columns
    required_columns = {'open', 'high', 'low', 'close'}
    if not required_columns.issubset(df.columns):
        missing = required_columns - set(df.columns)
        raise ValueError(f"Dataset missing required columns: {missing}")
    
    print(f"Loaded {len(df)} rows from {dataset}")
    print(f"Date range: {df.index[0]} to {df.index[-1]}")
    
    return df




def save_test_data(df: pd.DataFrame, name: str, format: str = 'parquet') -> str:
    """
    Save DataFrame as test data
    
    Args:
        df: DataFrame to save
        name: Name for the dataset (without extension)
        format: 'parquet' or 'pickle'
        
    Returns:
        Path to saved file
    """
    data_dir = get_data_dir()
    
    if format == 'parquet':
        file_path = data_dir / f"{name}.parquet"
        df.to_parquet(file_path, compression='snappy')
    elif format == 'pickle':
        file_path = data_dir / f"{name}.pkl"
        df.to_pickle(file_path)
    else:
        raise ValueError(f"Unsupported format: {format}")
    
    print(f"Saved {len(df)} rows to {file_path}")
    return str(file_path)


# Quick test when run directly
if __name__ == "__main__":
    print("Available datasets:")
    for dataset in list_test_datasets():
        print(f"  - {dataset['filename']} ({dataset['rows']} rows, {dataset['size_mb']:.1f} MB)")
    
    print("\nLoading default dataset...")
    data = load_test_data()
    print(f"\nDataFrame shape: {data.shape}")
    print(f"Columns: {list(data.columns)}")
    print(f"\nFirst few rows:")
    print(data.head())
    
    print(f"\nLast few rows:")
    print(data.tail())