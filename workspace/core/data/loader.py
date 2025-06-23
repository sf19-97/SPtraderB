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
    if data_source == 'live':
        # Load from cache parameters
        symbol = os.environ.get('LIVE_SYMBOL', 'EURUSD')
        timeframe = os.environ.get('LIVE_TIMEFRAME', '1h')
        from_ts = os.environ.get('LIVE_FROM')
        to_ts = os.environ.get('LIVE_TO')
        cache_key = os.environ.get('CACHE_KEY')
        
        print(f"Using Live mode: {symbol} {timeframe}")
        print(f"Cache key: {cache_key}")
        
        # For now, we'll create sample data with the correct parameters
        # In the future, this would connect to the actual cache
        # through a Tauri command or shared memory
        
        # Create realistic data for the requested symbol
        if from_ts and to_ts:
            start_date = pd.to_datetime(int(from_ts), unit='s')
            end_date = pd.to_datetime(int(to_ts), unit='s')
            
            # Calculate number of periods based on timeframe
            freq_map = {
                '5m': '5min',
                '15m': '15min',
                '1h': '1h',
                '4h': '4h',
                '12h': '12h'
            }
            freq = freq_map.get(timeframe, '1h')
            
            dates = pd.date_range(start=start_date, end=end_date, freq=freq)
            periods = len(dates)
            
            print(f"Date range: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
            print(f"Generating {periods} candles")
            
            # Base price depends on symbol
            base_prices = {
                'EURUSD': 1.0850,
                'USDJPY': 150.00,
                'GBPUSD': 1.2700,
                'AUDUSD': 0.6600
            }
            base_price = base_prices.get(symbol, 1.0000)
            
            # Generate realistic price movement
            import numpy as np
            np.random.seed(42)
            returns = np.random.normal(0.0001, 0.002, periods)
            close_prices = base_price * np.exp(np.cumsum(returns))
            
            # Generate OHLC
            high_prices = close_prices * (1 + np.abs(np.random.normal(0, 0.001, periods)))
            low_prices = close_prices * (1 - np.abs(np.random.normal(0, 0.001, periods)))
            open_prices = np.roll(close_prices, 1)
            open_prices[0] = close_prices[0]
            
            # Create DataFrame
            df = pd.DataFrame({
                'open': open_prices,
                'high': high_prices,
                'low': low_prices,
                'close': close_prices,
                'volume': np.random.poisson(1000000, periods)
            }, index=dates)
            
            # Ensure high/low are correct
            df['high'] = df[['open', 'high', 'low', 'close']].max(axis=1)
            df['low'] = df[['open', 'high', 'low', 'close']].min(axis=1)
            
            return df
        else:
            # Fall back to default sample data
            return create_sample_data()
            
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
            # If no cached data exists, create sample data
            print("No cached test data found. Creating sample data...")
            return create_sample_data()
    
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
            print(f"Dataset '{dataset}' not found. Creating sample data...")
            return create_sample_data()
    
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


def create_sample_data(periods: int = 1000) -> pd.DataFrame:
    """
    Create sample OHLCV data for testing
    
    Args:
        periods: Number of periods to generate
        
    Returns:
        DataFrame with sample data
    """
    import numpy as np
    
    # Generate timestamps
    dates = pd.date_range(end='2024-12-31', periods=periods, freq='1h')
    
    # Generate realistic price movement
    np.random.seed(42)
    returns = np.random.normal(0.0001, 0.002, periods)
    close_prices = 1.0800 * np.exp(np.cumsum(returns))
    
    # Generate OHLC from close
    high_prices = close_prices * (1 + np.abs(np.random.normal(0, 0.001, periods)))
    low_prices = close_prices * (1 - np.abs(np.random.normal(0, 0.001, periods)))
    open_prices = np.roll(close_prices, 1)
    open_prices[0] = close_prices[0]
    
    # Add some gaps to make it realistic
    for i in range(1, len(open_prices)):
        if np.random.random() < 0.3:  # 30% chance of gap
            gap = np.random.normal(0, 0.0005)
            open_prices[i] = close_prices[i-1] * (1 + gap)
    
    # Generate volume
    base_volume = 1000000
    volume = np.random.poisson(base_volume, periods)
    
    # Create DataFrame
    df = pd.DataFrame({
        'open': open_prices,
        'high': high_prices,
        'low': low_prices,
        'close': close_prices,
        'volume': volume
    }, index=dates)
    
    # Ensure high is highest and low is lowest
    df['high'] = df[['open', 'high', 'low', 'close']].max(axis=1)
    df['low'] = df[['open', 'high', 'low', 'close']].min(axis=1)
    
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