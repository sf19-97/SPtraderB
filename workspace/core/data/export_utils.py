"""
Utilities for exporting test data from the database
"""
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime

# This would normally use Tauri's invoke, but for Python components we'll use a placeholder
async def export_test_data_from_db(
    symbol: str,
    timeframe: str,
    start_date: str,
    end_date: str,
    filename: Optional[str] = None
) -> Dict[str, Any]:
    """
    Export data from database to CSV file
    
    Args:
        symbol: Trading pair (e.g., 'EURUSD', 'USDJPY')
        timeframe: Timeframe ('5m', '15m', '1h', '4h', '12h')
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
        filename: Optional output filename (defaults to auto-generated)
        
    Returns:
        Dictionary with export results
    """
    if filename is None:
        # Generate filename from parameters
        start = datetime.strptime(start_date, '%Y-%m-%d').strftime('%Y%m%d')
        end = datetime.strptime(end_date, '%Y-%m-%d').strftime('%Y%m%d')
        filename = f"{symbol.lower()}_{timeframe}_{start}_{end}.csv"
    
    # This is a placeholder - in the real app, this would call Tauri
    # For now, return a mock response
    return {
        'success': True,
        'filename': filename,
        'path': f"workspace/data/{filename}",
        'rows': 1000,  # Mock data
        'message': f"Exported {symbol} {timeframe} data from {start_date} to {end_date}"
    }


def get_available_datasets() -> list[Dict[str, Any]]:
    """
    Get list of available test datasets
    
    Returns:
        List of dataset information dictionaries
    """
    from .loader import list_test_datasets
    return list_test_datasets()


def export_and_convert(
    symbol: str,
    timeframe: str,
    start_date: str,
    end_date: str,
    keep_csv: bool = False
) -> str:
    """
    Export data from database and convert to Parquet
    
    Args:
        symbol: Trading pair
        timeframe: Timeframe
        start_date: Start date
        end_date: End date
        keep_csv: Whether to keep the CSV file after conversion
        
    Returns:
        Path to the parquet file
    """
    from .csv_to_parquet import convert_csv_to_parquet
    
    # Export to CSV first
    result = asyncio.run(export_test_data_from_db(
        symbol, timeframe, start_date, end_date
    ))
    
    if not result['success']:
        raise Exception(f"Export failed: {result.get('message', 'Unknown error')}")
    
    csv_path = Path(result['path'])
    
    # Convert to Parquet
    parquet_path = convert_csv_to_parquet(str(csv_path))
    
    # Remove CSV if requested
    if not keep_csv and csv_path.exists():
        csv_path.unlink()
    
    return parquet_path


# Quick export presets for common use cases
def export_recent_data(symbol: str = 'EURUSD', timeframe: str = '1h', days: int = 30) -> str:
    """Export recent data for quick testing"""
    from datetime import datetime, timedelta
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    
    return export_and_convert(
        symbol,
        timeframe,
        start_date.strftime('%Y-%m-%d'),
        end_date.strftime('%Y-%m-%d')
    )


def export_backtest_data(
    symbol: str = 'EURUSD',
    timeframe: str = '1h',
    months: int = 6
) -> str:
    """Export larger dataset for backtesting"""
    from datetime import datetime, timedelta
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=months * 30)
    
    return export_and_convert(
        symbol,
        timeframe,
        start_date.strftime('%Y-%m-%d'),
        end_date.strftime('%Y-%m-%d')
    )


if __name__ == "__main__":
    # Example usage
    print("Available datasets:")
    for dataset in get_available_datasets():
        print(f"  - {dataset['filename']} ({dataset['rows']} rows, {dataset['size_mb']:.1f} MB)")