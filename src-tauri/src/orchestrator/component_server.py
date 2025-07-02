#!/usr/bin/env python3
"""
Component Server - Persistent Python process for executing trading components
Communicates via stdin/stdout using line-delimited JSON protocol
"""

import sys
import json
import os
import importlib
import importlib.util
import traceback
import time
from datetime import datetime
from typing import Dict, Any, List, Optional

try:
    import pandas as pd
    import numpy as np
except ImportError as e:
    sys.stderr.write(f"[FATAL] Failed to import required packages: {e}\n")
    sys.stderr.write("Please ensure pandas and numpy are installed: pip install pandas numpy\n")
    sys.stderr.flush()
    sys.exit(2)

class ComponentServer:
    def __init__(self):
        self.loaded_components = {}  # Cache loaded modules
        self.component_instances = {}  # Cache component instances
        
        # Add workspace to Python path
        # From src-tauri/src/orchestrator/ we need to go up to project root then into workspace
        workspace_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'workspace'))
        if workspace_dir not in sys.path:
            sys.path.insert(0, workspace_dir)
        
        # Log the workspace directory for debugging
        self.log("DEBUG", f"Workspace directory: {workspace_dir}")
        self.log("DEBUG", f"Workspace exists: {os.path.exists(workspace_dir)}")
        
        # Suppress debug output from components
        os.environ['DEBUG_SIGNALS'] = 'false'
        
    def log(self, level: str, message: str):
        """Send log message to Rust via stderr"""
        sys.stderr.write(f"[{level}] {message}\n")
        sys.stderr.flush()
        
    def send_response(self, request_id: str, success: bool, result: Optional[Dict] = None, error: Optional[str] = None):
        """Send JSON response to stdout"""
        response = {
            "id": request_id,
            "success": success
        }
        
        if result is not None:
            response["result"] = result
        if error is not None:
            response["error"] = error
            
        # Write as single line
        json_str = json.dumps(response)
        sys.stdout.write(json_str + "\n")
        sys.stdout.flush()
        
    def load_component(self, component_type: str, component_path: str) -> tuple:
        """Load a component module and return the main class and module"""
        cache_key = f"{component_type}:{component_path}"
        
        # Check cache first
        if cache_key in self.loaded_components:
            return self.loaded_components[cache_key]
        
        try:
            # Convert module path to file path
            if component_path.endswith('.py'):
                file_path = component_path
            else:
                file_path = component_path.replace('.', '/') + '.py'
            
            # Make path relative to workspace
            if not file_path.startswith('/'):
                workspace_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'workspace'))
                file_path = os.path.join(workspace_dir, file_path)
            
            self.log("DEBUG", f"Loading component from: {file_path}")
            
            # Load module dynamically
            spec = importlib.util.spec_from_file_location(component_path, file_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            
            # Find the main class based on component type
            if component_type == "indicator":
                # Look for class that inherits from Indicator base class
                try:
                    from core.base.indicator import Indicator
                    for attr_name in dir(module):
                        attr = getattr(module, attr_name)
                        if isinstance(attr, type) and issubclass(attr, Indicator) and attr != Indicator:
                            self.loaded_components[cache_key] = (attr, module)
                            return (attr, module)
                except ImportError:
                    self.log("WARN", "Could not import Indicator base class, using fallback")
                # Fallback: look for class that matches common patterns
                for attr_name in ['SMA', 'RSI', 'MACD', 'EMA', 'BB']:
                    if hasattr(module, attr_name):
                        attr = getattr(module, attr_name)
                        if isinstance(attr, type):
                            self.loaded_components[cache_key] = (attr, module)
                            return (attr, module)
                        
            elif component_type == "signal":
                # Look for class that inherits from Signal base class
                try:
                    from core.base.signal import Signal
                    for attr_name in dir(module):
                        attr = getattr(module, attr_name)
                        if isinstance(attr, type) and issubclass(attr, Signal) and attr != Signal:
                            self.loaded_components[cache_key] = (attr, module)
                            return (attr, module)
                except ImportError:
                    self.log("WARN", "Could not import Signal base class, using fallback")
                # Fallback: look for specific class names
                class_name = os.path.basename(file_path).replace('.py', '').replace('_', ' ').title().replace(' ', '')
                if hasattr(module, class_name):
                    attr = getattr(module, class_name)
                    if isinstance(attr, type):
                        self.loaded_components[cache_key] = (attr, module)
                        return (attr, module)
                        
            raise ValueError(f"Could not find main class in {component_path}")
            
        except Exception as e:
            self.log("ERROR", f"Failed to load component {component_path}: {str(e)}")
            raise
            
    def execute_indicator(self, request: Dict) -> Dict:
        """Execute an indicator component"""
        component_path = request["component_path"]
        candles = request["candles"]
        params = request.get("params", {})
        
        # Debug logging
        print(f"[ComponentServer] Executing indicator: {component_path} with {len(candles)} candles", file=sys.stderr)
        
        # Convert candles to DataFrame
        df = pd.DataFrame(candles)
        df['time'] = pd.to_datetime(df['time'], unit='s')
        df.set_index('time', inplace=True)
        
        # Load component class
        indicator_class, _ = self.load_component("indicator", component_path)
        
        # Create instance with parameters
        instance_key = f"{component_path}:{json.dumps(params, sort_keys=True)}"
        if instance_key not in self.component_instances:
            # Convert numeric parameters to int if they're whole numbers
            cleaned_params = {}
            for key, value in params.items():
                if isinstance(value, float) and value.is_integer():
                    cleaned_params[key] = int(value)
                else:
                    cleaned_params[key] = value
            
            if cleaned_params:
                instance = indicator_class(**cleaned_params)
            else:
                instance = indicator_class()
            self.component_instances[instance_key] = instance
        else:
            instance = self.component_instances[instance_key]
        
        # Execute calculation
        start_time = time.time()
        result = instance.calculate(df)
        execution_time_ms = (time.time() - start_time) * 1000
        
        # Extract values
        if isinstance(result, pd.DataFrame):
            # Assume first column is the indicator values
            values = result.iloc[:, 0].tolist()
        elif isinstance(result, pd.Series):
            values = result.tolist()
        else:
            values = []
            
        # Convert NaN to None for JSON serialization
        values = [None if pd.isna(v) else float(v) for v in values]
        
        return {
            "indicator_values": values,
            "execution_time_ms": execution_time_ms
        }
        
    def execute_signal(self, request: Dict) -> Dict:
        """Execute a signal component"""
        component_path = request["component_path"]
        candles = request["candles"]
        params = request.get("params", {})
        indicator_data = request.get("indicator_data", {})
        
        # Convert candles to DataFrame
        df = pd.DataFrame(candles)
        df['time'] = pd.to_datetime(df['time'], unit='s')
        df.set_index('time', inplace=True)
        
        # Load component class
        signal_class, _ = self.load_component("signal", component_path)
        
        # Create instance
        instance_key = f"{component_path}:{json.dumps(params, sort_keys=True)}"
        if instance_key not in self.component_instances:
            if params:
                instance = signal_class(**params)
            else:
                instance = signal_class()
            self.component_instances[instance_key] = instance
        else:
            instance = self.component_instances[instance_key]
        
        # Prepare indicators
        indicators = {}
        for name, values in indicator_data.items():
            # Handle length mismatch by padding with NaN
            if len(values) < len(df):
                # Pad with NaN at the beginning
                padding = [float('nan')] * (len(df) - len(values))
                padded_values = padding + values
                series = pd.Series(padded_values, index=df.index)
            elif len(values) > len(df):
                # Truncate if too many values
                series = pd.Series(values[-len(df):], index=df.index)
            else:
                # Perfect match
                series = pd.Series(values, index=df.index)
            indicators[name] = series
            
        # Execute signal evaluation
        start_time = time.time()
        result = instance.evaluate(df, indicators)
        execution_time_ms = (time.time() - start_time) * 1000
        
        # Parse signal events
        signals = []
        if isinstance(result, pd.DataFrame) and 'signal' in result.columns:
            # Find rows where signal is True
            signal_rows = result[result['signal'] == True]
            
            for idx, row in signal_rows.iterrows():
                signal_event = {
                    "timestamp": idx.strftime('%Y-%m-%dT%H:%M:%S+00:00'),
                    "signal_name": component_path.split('.')[-1],
                    "signal_type": row.get('crossover_type', 'unknown'),
                    "strength": float(row.get('signal_strength', 1.0)),
                    "metadata": {
                        "close": float(df.loc[idx, 'close']),
                        "symbol": os.environ.get('SYMBOL', 'EURUSD')
                    }
                }
                signals.append(signal_event)
                
        return {
            "signals": signals,
            "execution_time_ms": execution_time_ms
        }
        
    def handle_request(self, request: Dict):
        """Handle a single request"""
        request_id = request.get("id", "unknown")
        
        try:
            command = request.get("command")
            
            if command == "execute":
                component_type = request.get("component_type")
                
                if component_type == "indicator":
                    result = self.execute_indicator(request)
                    self.send_response(request_id, True, result)
                    
                elif component_type == "signal":
                    result = self.execute_signal(request)
                    self.send_response(request_id, True, result)
                    
                else:
                    self.send_response(request_id, False, error=f"Unknown component type: {component_type}")
                    
            elif command == "get_metadata":
                component_type = request.get("component_type")
                component_path = request.get("component_path")
                
                try:
                    # Load the component to get its metadata
                    component_class, module = self.load_component(component_type, component_path)
                    
                    # Get metadata from the module
                    metadata = {}
                    # Try different metadata attribute names
                    if hasattr(module, '__metadata__'):
                        metadata = module.__metadata__
                    elif hasattr(module, 'metadata'):
                        metadata = module.metadata
                    
                    self.send_response(request_id, True, {"metadata": metadata})
                except Exception as e:
                    error_detail = f"{str(e)}\n{traceback.format_exc()}"
                    self.log("ERROR", f"Failed to get metadata: {error_detail}")
                    self.send_response(request_id, False, error=str(e))
                    
            elif command == "ping":
                self.send_response(request_id, True, {"message": "pong"})
                
            elif command == "shutdown":
                self.send_response(request_id, True, {"message": "shutting down"})
                return False  # Signal to stop the server
                
            else:
                self.send_response(request_id, False, error=f"Unknown command: {command}")
                
        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
            self.log("ERROR", error_msg)
            self.send_response(request_id, False, error=error_msg)
            
        return True  # Continue running
        
    def run(self):
        """Main server loop - read requests from stdin"""
        self.log("INFO", "Component server started")
        
        try:
            while True:
                # Read line from stdin
                line = sys.stdin.readline()
                if not line:
                    break  # EOF
                    
                line = line.strip()
                if not line:
                    continue  # Empty line
                    
                try:
                    # Parse JSON request
                    request = json.loads(line)
                    
                    # Handle request
                    should_continue = self.handle_request(request)
                    if not should_continue:
                        break
                        
                except json.JSONDecodeError as e:
                    self.log("ERROR", f"Invalid JSON: {e}")
                    # Send error response with a generic ID
                    self.send_response("error", False, error=f"Invalid JSON: {e}")
                    
        except KeyboardInterrupt:
            self.log("INFO", "Component server interrupted")
        except Exception as e:
            self.log("ERROR", f"Server error: {e}\n{traceback.format_exc()}")
        finally:
            self.log("INFO", "Component server stopped")


if __name__ == "__main__":
    try:
        server = ComponentServer()
        server.run()
    except Exception as e:
        sys.stderr.write(f"[FATAL] Failed to start component server: {e}\n{traceback.format_exc()}\n")
        sys.stderr.flush()
        sys.exit(2)