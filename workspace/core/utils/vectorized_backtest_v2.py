"""
Vectorized backtest calculator V2 - Dynamically loads and runs any strategy
"""
import pandas as pd
import numpy as np
import json
import sys
import os
import importlib.util
from datetime import datetime
from typing import Dict, List, Any

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

def load_component(component_path: str):
    """Dynamically load a Python component module"""
    # Convert module path to file path
    # e.g., "core.indicators.trend.ema" -> "core/indicators/trend/ema.py"
    path_parts = component_path.split('.')
    file_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 
                             *path_parts[1:]) + '.py'
    
    # Load the module
    spec = importlib.util.spec_from_file_location(component_path, file_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    
    return module

def run_vectorized_backtest(candles, strategy_config):
    """
    Run backtest calculation on all candles at once using dynamic component loading
    """
    # Convert candles to DataFrame
    df = pd.DataFrame(candles)
    df['time'] = pd.to_datetime(df['time'], unit='s', utc=True)
    df.set_index('time', inplace=True)
    
    # Results containers
    indicators = {}
    signals = []
    
    # Get strategy dependencies
    signal_paths = strategy_config.get('dependencies', {}).get('signals', [])
    
    if not signal_paths:
        print("Warning: No signals defined in strategy", file=sys.stderr)
        return {'signals': [], 'indicators': {}}
    
    # Process each signal
    for signal_path in signal_paths:
        try:
            # Load the signal module
            signal_module = load_component(signal_path)
            
            # Get signal metadata
            signal_metadata = getattr(signal_module, '__metadata__', {})
            
            # Check if strategy has signal_config overrides
            signal_name_short = signal_path.split('.')[-1]
            signal_overrides = strategy_config.get('signal_config', {}).get(signal_name_short, {})
            
            # Use overrides if present, otherwise use metadata
            if 'required_indicators' in signal_overrides:
                required_indicators = signal_overrides['required_indicators']
            else:
                required_indicators = signal_metadata.get('required_indicators', [])
            
            # Calculate required indicators
            signal_indicators = {}
            for indicator_config in required_indicators:
                indicator_name = indicator_config['name']
                indicator_type = indicator_config['type']
                # Check both 'params' and 'parameters' for compatibility
                indicator_params = indicator_config.get('params', indicator_config.get('parameters', {}))
                
                # Build full indicator path
                if '.' in indicator_type:
                    indicator_path = indicator_type
                else:
                    # Try common paths
                    for category in ['trend', 'momentum', 'volatility']:
                        test_path = f"core.indicators.{category}.{indicator_type}"
                        try:
                            indicator_module = load_component(test_path)
                            indicator_path = test_path
                            break
                        except:
                            continue
                
                # Load and run the indicator
                indicator_module = load_component(indicator_path)
                
                # Get the indicator class (usually named after the indicator type in uppercase)
                indicator_class_name = indicator_type.upper()
                indicator_class = getattr(indicator_module, indicator_class_name)
                
                # Create indicator instance with parameters
                print(f"Creating {indicator_name} with params: {indicator_params}", file=sys.stderr)
                indicator_instance = indicator_class(**indicator_params)
                
                # Calculate indicator values
                result = indicator_instance.calculate(df)
                
                # Store the result (assuming single output column matching indicator name)
                output_col = list(result.columns)[0]
                signal_indicators[indicator_name] = result[output_col]
                indicators[indicator_name] = result[output_col]
            
            # Add price data to indicators for signal generation
            signal_indicators['close'] = df['close']
            
            # Generate signals using the signal module
            # Check if it has a generate_signals function (new style)
            if hasattr(signal_module, 'generate_signals'):
                signal_function = getattr(signal_module, 'generate_signals')
                signal_events = signal_function(signal_indicators, strategy_config.get('signal_config', {}).get(signal_path.split('.')[-1], {}))
            else:
                # Old style - instantiate the signal class
                # Find the signal class (usually named after the signal type in CamelCase)
                signal_name = signal_path.split('.')[-1]
                
                # Try different naming conventions
                possible_class_names = [
                    ''.join(word.capitalize() for word in signal_name.split('_')),  # MaCrossover
                    signal_name.replace('_', '').capitalize(),  # Macrossover
                    'MAcrossover' if signal_name == 'ma_crossover' else None,  # MAcrossover (special case)
                ]
                
                signal_class = None
                for class_name in possible_class_names:
                    if class_name and hasattr(signal_module, class_name):
                        signal_class = getattr(signal_module, class_name)
                        break
                
                if signal_class:
                    signal_instance = signal_class()
                    
                    # Call evaluate method (signal class interface)
                    print(f"Evaluating {signal_name} with {len(df)} candles", file=sys.stderr)
                    print(f"MA values - Fast: {signal_indicators.get('ma_fast', pd.Series()).iloc[-5:].tolist() if 'ma_fast' in signal_indicators else 'N/A'}", file=sys.stderr)
                    print(f"MA values - Slow: {signal_indicators.get('ma_slow', pd.Series()).iloc[-5:].tolist() if 'ma_slow' in signal_indicators else 'N/A'}", file=sys.stderr)
                    signal_df = signal_instance.evaluate(df, signal_indicators)
                    print(f"Signal evaluation returned {len(signal_df)} rows, {(signal_df['signal'] != 0).sum()} signals", file=sys.stderr)
                    
                    # Convert DataFrame result to signal events
                    signal_events = []
                    for idx in signal_df.index:
                        signal_value = signal_df.loc[idx, 'signal']
                        # Handle both boolean (True/False) and numeric (1/-1/0) signals
                        if (isinstance(signal_value, bool) and signal_value) or (signal_value != 0):
                            signal_type = signal_df.loc[idx, 'crossover_type'] if 'crossover_type' in signal_df.columns else 'unknown'
                            # Ensure timestamp has timezone info (UTC)
                            if hasattr(idx, 'tz'):
                                if idx.tz is None:
                                    timestamp = idx.tz_localize('UTC')
                                else:
                                    timestamp = idx.tz_convert('UTC')
                            else:
                                timestamp = idx
                            
                            # Build metadata with indicator values
                            metadata = {}
                            for ind_name, ind_values in signal_indicators.items():
                                if ind_name != 'close' and idx in ind_values.index:
                                    metadata[ind_name] = float(ind_values.loc[idx])
                            
                            signal_events.append({
                                'timestamp': timestamp.isoformat() if hasattr(timestamp, 'isoformat') else str(timestamp),
                                'signal_type': signal_type,
                                'strength': float(signal_df.loc[idx, 'signal_strength']) if 'signal_strength' in signal_df.columns else 1.0,
                                'price': float(df.loc[idx, 'close']),
                                'metadata': metadata
                            })
                else:
                    print(f"Warning: Could not find signal class {class_name} in {signal_path}", file=sys.stderr)
                    signal_events = []
            
            # Add signal name to each event
            for event in signal_events:
                event['signal_name'] = signal_path.split('.')[-1]
            
            signals.extend(signal_events)
            
        except Exception as e:
            print(f"Error processing signal {signal_path}: {str(e)}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
    
    # Prepare indicator data for chart (convert to list format)
    chart_indicators = {}
    for name, series in indicators.items():
        # Convert to list, handling NaN values
        values = []
        for v in series:
            if pd.isna(v):
                values.append(None)
            else:
                values.append(float(v))
        chart_indicators[name] = values
    
    return {
        'signals': signals,
        'indicators': chart_indicators,
        'stats': {
            'total_candles': len(df),
            'total_signals': len(signals),
            'calculation_time_ms': 0  # Will be set by main
        }
    }

if __name__ == "__main__":
    # Read input from stdin
    input_data = json.loads(sys.stdin.read())
    
    start_time = datetime.now()
    
    candles = input_data['candles']
    strategy_config = input_data['strategy_config']
    
    # Run the vectorized backtest
    result = run_vectorized_backtest(candles, strategy_config)
    
    # Add timing
    result['stats']['calculation_time_ms'] = (datetime.now() - start_time).total_seconds() * 1000
    
    # Output result
    print(json.dumps(result))