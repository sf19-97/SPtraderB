use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::env;
use tokio::process::Command;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use std::time::Instant;
use tauri::Emitter;
use std::fs::File;
use arrow::array::{Array, Float64Array, StringArray, TimestampMillisecondArray};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    name: String,
    path: String,
    #[serde(rename = "type")]
    node_type: String,
    children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub async fn get_workspace_tree() -> Result<Vec<FileNode>, String> {
    // Get current directory and find workspace
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    // Go up one directory from src-tauri to project root
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace");
    
    if !workspace_path.exists() {
        return Err("Workspace directory not found".to_string());
    }
    
    let mut root_nodes = Vec::new();
    
    // Read top-level directories (core, strategies, etc.)
    for entry in fs::read_dir(&workspace_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if let Some(node) = build_file_node(&path, &workspace_path) {
            root_nodes.push(node);
        }
    }
    
    // Sort by name
    root_nodes.sort_by(|a, b| a.name.cmp(&b.name));
    
    Ok(root_nodes)
}

fn build_file_node(path: &Path, base_path: &Path) -> Option<FileNode> {
    let name = path.file_name()?.to_str()?.to_string();
    
    // Skip hidden files and __pycache__
    if name.starts_with('.') || name == "__pycache__" {
        return None;
    }
    
    let relative_path = path.strip_prefix(base_path).ok()?
        .to_str()?
        .to_string()
        .replace('\\', "/"); // Normalize path separators
    
    if path.is_dir() {
        let mut children = Vec::new();
        
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Some(child) = build_file_node(&entry.path(), base_path) {
                    children.push(child);
                }
            }
        }
        
        children.sort_by(|a, b| {
            // Folders first, then files
            match (a.node_type.as_str(), b.node_type.as_str()) {
                ("folder", "file") => std::cmp::Ordering::Less,
                ("file", "folder") => std::cmp::Ordering::Greater,
                _ => a.name.cmp(&b.name),
            }
        });
        
        Some(FileNode {
            name,
            path: relative_path,
            node_type: "folder".to_string(),
            children: Some(children),
        })
    } else if path.is_file() {
        // Only include Python and YAML files
        let extension = path.extension()?.to_str()?;
        if matches!(extension, "py" | "yaml" | "yml") {
            Some(FileNode {
                name,
                path: relative_path,
                node_type: "file".to_string(),
                children: None,
            })
        } else {
            None
        }
    } else {
        None
    }
}

#[tauri::command]
pub async fn read_component_file(file_path: String) -> Result<String, String> {
    // Validate path to prevent directory traversal
    if file_path.contains("..") {
        return Err("Invalid file path".to_string());
    }
    
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace");
    let full_path = workspace_path.join(&file_path);
    
    // Ensure the file is within the workspace
    if !full_path.starts_with(&workspace_path) {
        return Err("Access denied: file outside workspace".to_string());
    }
    
    fs::read_to_string(full_path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn save_component_file(
    file_path: String, 
    content: String
) -> Result<(), String> {
    // Validate path
    if file_path.contains("..") {
        return Err("Invalid file path".to_string());
    }
    
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace");
    let full_path = workspace_path.join(&file_path);
    
    // Ensure the file is within the workspace
    if !full_path.starts_with(&workspace_path) {
        return Err("Access denied: file outside workspace".to_string());
    }
    
    // Create parent directories if needed
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    
    fs::write(full_path, content)
        .map_err(|e| format!("Failed to save file: {}", e))
}

#[tauri::command]
pub async fn create_component_file(
    file_path: String,
    component_type: String
) -> Result<(), String> {
    // For now, use inline templates until we set up the template files
    let template = match component_type.as_str() {
        "indicator" => r#"""
Indicator: New Indicator
"""
import pandas as pd
from typing import Dict, Any
from core.base.indicator import Indicator

__metadata_version__ = 1
__metadata__ = {
    'name': 'new_indicator',
    'category': 'momentum',
    'version': '0.1.0',
    'description': 'TODO: Add description',
    'author': 'system',
    'status': 'prototype',
    'inputs': ['close'],
    'outputs': ['value'],
    'parameters': {
        'period': {
            'type': 'int',
            'default': 14,
            'min': 2,
            'max': 100,
            'description': 'Calculation period'
        }
    },
    'tags': ['TODO']
}

class NewIndicator(Indicator):
    """
    TODO: Add indicator description
    """
    
    def __init__(self, period: int = 14):
        super().__init__()
        self.period = period
        
    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate indicator values
        
        Args:
            data: DataFrame with OHLC columns
            
        Returns:
            DataFrame with indicator output columns
        """
        # TODO: Implement calculation
        # Example: result = data['close'].rolling(self.period).mean()
        
        return pd.DataFrame({'value': pd.Series(dtype=float)})
    
    @property
    def metadata(self) -> Dict[str, Any]:
        return __metadata__
"#,
        "signal" => r#"""
Signal: New Signal
"""
import pandas as pd
from typing import List, Dict, Any
from core.base.signal import Signal

__metadata_version__ = 1
__metadata__ = {
    'name': 'new_signal',
    'description': 'TODO: Add description',
    'category': 'mean_reversion',
    'version': '0.1.0',
    'author': 'system',
    'status': 'prototype',
    'required_indicators': ['TODO'],
    'outputs': ['boolean', 'signal_strength'],
    'parameters': {
        'threshold': {
            'type': 'float',
            'default': 0.0,
            'description': 'Signal threshold'
        }
    },
    'tags': ['TODO']
}

class NewSignal(Signal):
    """
    TODO: Add signal description
    """
    
    def __init__(self, threshold: float = 0.0):
        self.threshold = threshold
    
    @property
    def required_indicators(self) -> List[str]:
        """List of required indicators"""
        return __metadata__['required_indicators']
    
    def evaluate(self, data: pd.DataFrame, indicators: Dict[str, pd.Series]) -> pd.Series:
        """
        Evaluate signal conditions
        
        Args:
            data: OHLC DataFrame
            indicators: Dictionary of calculated indicator values
            
        Returns:
            Boolean series indicating signal triggers
        """
        # TODO: Implement signal logic
        # Example:
        # if 'rsi' in indicators:
        #     return indicators['rsi'] < 30  # Oversold condition
        
        return pd.Series([False] * len(data), index=data.index)
    
    @property
    def metadata(self) -> Dict[str, Any]:
        return __metadata__
"#,
        "order" => r#"""
Order: New Order Executor
"""
import pandas as pd
from typing import Dict, Any, Optional
from core.base.order import Order

__metadata_version__ = 1
__metadata__ = {
    'name': 'new_order',
    'category': 'market',
    'version': '0.1.0',
    'description': 'TODO: Add description',
    'author': 'system',
    'status': 'prototype',
    'order_types': ['market', 'limit'],
    'parameters': {
        'size': {
            'type': 'float',
            'default': 1.0,
            'min': 0.0,
            'description': 'Order size'
        }
    },
    'tags': ['TODO']
}

class NewOrder(Order):
    """
    TODO: Add order executor description
    """
    
    def __init__(self, size: float = 1.0, **params):
        self.size = size
        self.params = params
    
    def execute(self, market_state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute order
        
        Args:
            market_state: Current market data and conditions
            
        Returns:
            Order details to be sent to exchange
        """
        # TODO: Implement execution logic
        order = {
            'type': 'market',
            'side': 'buy',
            'size': self.size,
            'symbol': market_state.get('symbol', 'UNKNOWN'),
            'timestamp': pd.Timestamp.now()
        }
        return order
    
    @property
    def metadata(self) -> Dict[str, Any]:
        return __metadata__
"#,
        "strategy" => r#"name: new_strategy
type: strategy
version: 0.1.0
author: system
description: TODO Add strategy description

# Import components
dependencies:
  indicators:
    # - core.indicators.momentum.rsi
    # - core.indicators.trend.ema
  signals:
    # - core.signals.entry.oversold
  orders:
    # - core.orders.execution_algos.market

# Strategy parameters
parameters:
  position_size: 0.01  # 1% of capital
  max_positions: 1
  stop_loss: 0.02      # 2% stop
  take_profit: 0.04    # 4% target
  
# Risk management
risk:
  max_drawdown: 0.10      # 10% max drawdown
  daily_loss_limit: 0.02  # 2% daily loss limit
  position_limit: 0.05    # 5% max per position
  
# Execution settings  
execution:
  order_type: market
  slippage_tolerance: 0.0005
  rebalance_frequency: 1h
  
# Market filters
filters:
  min_volume: 1000000
  max_spread: 0.001
  trading_hours: "09:30-16:00"
  
# Entry conditions
entry:
  # TODO: Define entry logic
  # Example:
  # when:
  #   - indicators.rsi < 30
  #   - signals.oversold == true
  # action: buy
  
# Exit conditions
exit:
  # TODO: Define exit logic
  # Example:
  # when:
  #   - position.pnl_percent >= parameters.take_profit
  #   - position.pnl_percent <= -parameters.stop_loss
  # action: close
"#,
        _ => "# New component\n",
    };
    
    save_component_file(file_path, template.to_string()).await
}

#[derive(Debug, Serialize)]
pub struct RunResult {
    success: bool,
    execution_time_ms: f64,
    output_lines: usize,
    error_lines: usize,
}

#[tauri::command]
pub async fn get_indicator_categories() -> Result<Vec<String>, String> {
    get_component_categories("indicator".to_string()).await
}

#[tauri::command]
pub async fn get_component_categories(component_type: String) -> Result<Vec<String>, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace");
    
    let component_path = match component_type.as_str() {
        "indicator" => workspace_path.join("core").join("indicators"),
        "signal" => workspace_path.join("core").join("signals"),
        "order" => workspace_path.join("core").join("orders"),
        _ => return Err(format!("Invalid component type: {}", component_type)),
    };
    
    if !component_path.exists() {
        // Return default categories if directory doesn't exist
        let defaults = match component_type.as_str() {
            "indicator" => vec!["momentum", "trend", "volatility", "volume", "microstructure"],
            "signal" => vec![], // No default categories - signals are flat
            "order" => vec!["execution_algos", "risk_filters", "smart_routing"],
            _ => vec![],
        };
        return Ok(defaults.into_iter().map(String::from).collect());
    }
    
    let mut categories = Vec::new();
    
    // Read all subdirectories in the component folder
    for entry in fs::read_dir(&component_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if path.is_dir() {
            if let Some(name) = path.file_name() {
                if let Some(name_str) = name.to_str() {
                    // Skip hidden directories and __pycache__
                    if !name_str.starts_with('.') && name_str != "__pycache__" {
                        categories.push(name_str.to_string());
                    }
                }
            }
        }
    }
    
    categories.sort();
    Ok(categories)
}

#[derive(Debug, Serialize)]
pub struct ComponentInfo {
    name: String,
    component_type: String,
    category: String,
    path: String,
    has_metadata: bool,
    status: String,
}

#[tauri::command]
pub async fn get_workspace_components() -> Result<Vec<ComponentInfo>, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace");
    
    let mut components = Vec::new();
    
    // Scan indicators
    let indicators_path = workspace_path.join("core").join("indicators");
    if indicators_path.exists() {
        scan_component_directory(&indicators_path, "indicator", &mut components)?;
    }
    
    // Scan signals
    let signals_path = workspace_path.join("core").join("signals");
    if signals_path.exists() {
        scan_component_directory(&signals_path, "signal", &mut components)?;
    }
    
    // Scan orders
    let orders_path = workspace_path.join("core").join("orders");
    if orders_path.exists() {
        scan_component_directory(&orders_path, "order", &mut components)?;
    }
    
    // Scan strategies
    let strategies_path = workspace_path.join("strategies");
    if strategies_path.exists() {
        for entry in fs::read_dir(&strategies_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            
            if path.is_file() && path.extension().map_or(false, |ext| ext == "yaml" || ext == "yml") {
                if let Some(name) = path.file_stem() {
                    if let Some(name_str) = name.to_str() {
                        let relative_path = path.strip_prefix(&workspace_path)
                            .map_err(|e| e.to_string())?
                            .to_str()
                            .ok_or("Invalid path")?
                            .to_string()
                            .replace('\\', "/");
                        
                        components.push(ComponentInfo {
                            name: name_str.to_string(),
                            component_type: "strategy".to_string(),
                            category: "strategy".to_string(),
                            path: relative_path,
                            has_metadata: true, // YAML files always have metadata
                            status: "ready".to_string(), // Strategies default to ready
                        });
                    }
                }
            }
        }
    }
    
    // Sort by type and name
    components.sort_by(|a, b| {
        a.component_type.cmp(&b.component_type)
            .then(a.name.cmp(&b.name))
    });
    
    Ok(components)
}

fn scan_component_directory(
    dir_path: &Path, 
    component_type: &str, 
    components: &mut Vec<ComponentInfo>
) -> Result<(), String> {
    for entry in fs::read_dir(dir_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if path.is_dir() {
            // Recursively scan subdirectories
            scan_component_directory(&path, component_type, components)?;
        } else if path.is_file() && path.extension().map_or(false, |ext| ext == "py") {
            if let Some(name) = path.file_stem() {
                if let Some(name_str) = name.to_str() {
                    // Skip test files and __init__.py
                    if name_str.starts_with("test_") || name_str == "__init__" {
                        continue;
                    }
                    
                    // Determine category from path
                    let category = if let Some(parent) = path.parent() {
                        parent.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("uncategorized")
                            .to_string()
                    } else {
                        "uncategorized".to_string()
                    };
                    
                    let workspace_path = env::current_dir()
                        .ok()
                        .and_then(|d| d.parent().map(|p| p.join("workspace")))
                        .ok_or("Failed to get workspace path")?;
                    
                    let relative_path = path.strip_prefix(&workspace_path)
                        .map_err(|e| e.to_string())?
                        .to_str()
                        .ok_or("Invalid path")?
                        .to_string()
                        .replace('\\', "/");
                    
                    // Check if file has metadata and extract status
                    let (has_metadata, status) = if let Ok(content) = fs::read_to_string(&path) {
                        let has_meta = content.contains("__metadata__");
                        let status = if has_meta {
                            // Simple regex to extract status
                            if let Some(start) = content.find("'status': '") {
                                let status_start = start + 11;
                                if let Some(end) = content[status_start..].find('\'') {
                                    content[status_start..status_start + end].to_string()
                                } else {
                                    "prototype".to_string()
                                }
                            } else if let Some(start) = content.find("\"status\": \"") {
                                let status_start = start + 11;
                                if let Some(end) = content[status_start..].find('"') {
                                    content[status_start..status_start + end].to_string()
                                } else {
                                    "prototype".to_string()
                                }
                            } else {
                                "prototype".to_string()
                            }
                        } else {
                            "prototype".to_string()
                        };
                        (has_meta, status)
                    } else {
                        (false, "prototype".to_string())
                    };
                    
                    components.push(ComponentInfo {
                        name: name_str.to_string(),
                        component_type: component_type.to_string(),
                        category,
                        path: relative_path,
                        has_metadata,
                        status,
                    });
                }
            }
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn delete_component_file(file_path: String) -> Result<(), String> {
    // Validate path to prevent directory traversal
    if file_path.contains("..") {
        return Err("Invalid file path".to_string());
    }
    
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace");
    let full_path = workspace_path.join(&file_path);
    
    // Ensure the file is within the workspace
    if !full_path.starts_with(&workspace_path) {
        return Err("Access denied: file outside workspace".to_string());
    }
    
    // Check if file exists
    if !full_path.exists() {
        return Err("File not found".to_string());
    }
    
    // Delete the file
    fs::remove_file(full_path)
        .map_err(|e| format!("Failed to delete file: {}", e))
}

#[tauri::command]
pub async fn rename_component_file(
    old_path: String, 
    new_name: String
) -> Result<String, String> {
    // Validate paths - allow forward slashes in new_name for moving files
    if old_path.contains("..") || new_name.contains("..") || new_name.contains("\\") {
        return Err("Invalid file path or name".to_string());
    }
    
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace");
    let old_full_path = workspace_path.join(&old_path);
    
    // Ensure the file is within the workspace
    if !old_full_path.starts_with(&workspace_path) {
        return Err("Access denied: file outside workspace".to_string());
    }
    
    // Check if file exists
    if !old_full_path.exists() {
        return Err("File not found".to_string());
    }
    
    // Determine if this is a move or rename operation
    let new_full_path = if new_name.contains('/') {
        // It's a move operation - new_name is a relative path
        let new_path = workspace_path.join(&new_name);
        
        // Ensure the new path is still within workspace
        if !new_path.starts_with(&workspace_path) {
            return Err("Access denied: destination outside workspace".to_string());
        }
        
        // Ensure the target directory exists
        if let Some(parent) = new_path.parent() {
            if !parent.exists() {
                return Err("Target directory does not exist".to_string());
            }
        }
        
        new_path
    } else {
        // It's a simple rename in the same directory
        let parent = old_full_path.parent()
            .ok_or("Failed to get parent directory")?;
        parent.join(&new_name)
    };
    
    // Check if new file already exists
    if new_full_path.exists() {
        return Err("A file with that name already exists".to_string());
    }
    
    // Rename the file
    fs::rename(&old_full_path, &new_full_path)
        .map_err(|e| format!("Failed to rename file: {}", e))?;
    
    // Return the new relative path
    let new_relative_path = new_full_path.strip_prefix(&workspace_path)
        .map_err(|e| e.to_string())?
        .to_str()
        .ok_or("Invalid path")?
        .to_string()
        .replace('\\', "/");
    
    Ok(new_relative_path)
}

#[tauri::command]
pub async fn delete_component_folder(folder_path: String) -> Result<(), String> {
    // Validate path to prevent directory traversal
    if folder_path.contains("..") {
        return Err("Invalid folder path".to_string());
    }
    
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace");
    let full_path = workspace_path.join(&folder_path);
    
    // Ensure the folder is within the workspace
    if !full_path.starts_with(&workspace_path) {
        return Err("Access denied: folder outside workspace".to_string());
    }
    
    // Check if folder exists
    if !full_path.exists() {
        return Err("Folder not found".to_string());
    }
    
    // Only allow deletion of custom category folders in core components
    let is_valid_component_path = full_path.starts_with(workspace_path.join("core").join("indicators")) ||
                                  full_path.starts_with(workspace_path.join("core").join("signals")) ||
                                  full_path.starts_with(workspace_path.join("core").join("orders"));
    
    if !is_valid_component_path {
        return Err("Can only delete custom category folders in core components".to_string());
    }
    
    // Don't delete default categories
    let folder_name = full_path.file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid folder name")?;
    
    // Define default categories for each component type
    let is_indicator_path = full_path.starts_with(workspace_path.join("core").join("indicators"));
    let is_signal_path = full_path.starts_with(workspace_path.join("core").join("signals"));
    let is_order_path = full_path.starts_with(workspace_path.join("core").join("orders"));
    
    let default_indicator_categories = ["momentum", "trend", "volatility", "volume", "microstructure"];
    let default_signal_categories: [&str; 0] = []; // No default categories for signals
    let default_order_categories = ["execution_algos", "risk_filters", "smart_routing"];
    
    if (is_indicator_path && default_indicator_categories.contains(&folder_name)) ||
       (is_signal_path && default_signal_categories.contains(&folder_name)) ||
       (is_order_path && default_order_categories.contains(&folder_name)) {
        return Err("Cannot delete default category folders".to_string());
    }
    
    // Check if folder is empty or only contains __pycache__
    let mut entries = fs::read_dir(&full_path)
        .map_err(|e| format!("Failed to read folder: {}", e))?;
    
    let mut has_files = false;
    while let Some(entry) = entries.next() {
        if let Ok(entry) = entry {
            let name = entry.file_name();
            if name != "__pycache__" {
                has_files = true;
                break;
            }
        }
    }
    
    if has_files {
        return Err("Cannot delete folder: it contains files. Delete all files first.".to_string());
    }
    
    // Delete the folder
    fs::remove_dir_all(full_path)
        .map_err(|e| format!("Failed to delete folder: {}", e))
}

#[tauri::command]
pub async fn rename_component_folder(
    old_path: String, 
    new_name: String
) -> Result<String, String> {
    // Validate paths
    if old_path.contains("..") || new_name.contains("..") || new_name.contains("/") || new_name.contains("\\") {
        return Err("Invalid folder path or name".to_string());
    }
    
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace");
    let old_full_path = workspace_path.join(&old_path);
    
    // Ensure the folder is within the workspace
    if !old_full_path.starts_with(&workspace_path) {
        return Err("Access denied: folder outside workspace".to_string());
    }
    
    // Only allow renaming of custom category folders in core components
    let is_valid_component_path = old_full_path.starts_with(workspace_path.join("core").join("indicators")) ||
                                  old_full_path.starts_with(workspace_path.join("core").join("signals")) ||
                                  old_full_path.starts_with(workspace_path.join("core").join("orders"));
    
    if !is_valid_component_path {
        return Err("Can only rename custom category folders in core components".to_string());
    }
    
    // Don't rename default categories
    let old_folder_name = old_full_path.file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid folder name")?;
    
    // Define default categories for each component type
    let is_indicator_path = old_full_path.starts_with(workspace_path.join("core").join("indicators"));
    let is_signal_path = old_full_path.starts_with(workspace_path.join("core").join("signals"));
    let is_order_path = old_full_path.starts_with(workspace_path.join("core").join("orders"));
    
    let default_indicator_categories = ["momentum", "trend", "volatility", "volume", "microstructure"];
    let default_signal_categories: [&str; 0] = []; // No default categories for signals
    let default_order_categories = ["execution_algos", "risk_filters", "smart_routing"];
    
    if (is_indicator_path && default_indicator_categories.contains(&old_folder_name)) ||
       (is_signal_path && default_signal_categories.contains(&old_folder_name)) ||
       (is_order_path && default_order_categories.contains(&old_folder_name)) {
        return Err("Cannot rename default category folders".to_string());
    }
    
    // Check if folder exists
    if !old_full_path.exists() {
        return Err("Folder not found".to_string());
    }
    
    // Get the parent directory and create new path
    let parent = old_full_path.parent()
        .ok_or("Failed to get parent directory")?;
    let new_full_path = parent.join(&new_name);
    
    // Check if new folder already exists
    if new_full_path.exists() {
        return Err("A folder with that name already exists".to_string());
    }
    
    // Rename the folder
    fs::rename(&old_full_path, &new_full_path)
        .map_err(|e| format!("Failed to rename folder: {}", e))?;
    
    // Return the new relative path
    let new_relative_path = new_full_path.strip_prefix(&workspace_path)
        .map_err(|e| e.to_string())?
        .to_str()
        .ok_or("Invalid path")?
        .to_string()
        .replace('\\', "/");
    
    Ok(new_relative_path)
}

#[tauri::command]
pub async fn list_test_datasets() -> Result<Vec<String>, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let data_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace")
        .join("data");
    
    println!("Looking for datasets in: {:?}", data_path);
    
    if !data_path.exists() {
        println!("Data path does not exist");
        return Ok(Vec::new());
    }
    
    let mut datasets = Vec::new();
    
    // Read all parquet files in the data directory
    for entry in fs::read_dir(&data_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if path.is_file() && path.extension().map_or(false, |ext| ext == "parquet") {
            if let Some(name) = path.file_name() {
                if let Some(name_str) = name.to_str() {
                    datasets.push(name_str.to_string());
                }
            }
        }
    }
    
    datasets.sort();
    Ok(datasets)
}

#[tauri::command]
pub async fn run_component(
    file_path: String,
    dataset: Option<String>,
    env_vars: Option<std::collections::HashMap<String, String>>,
    window: tauri::Window,
) -> Result<RunResult, String> {
    // Validate path
    if file_path.contains("..") {
        return Err("Invalid file path".to_string());
    }
    
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let workspace_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace");
    let full_path = workspace_path.join(&file_path);
    
    // Ensure the file is within the workspace and is a Python file
    if !full_path.starts_with(&workspace_path) {
        return Err("Access denied: file outside workspace".to_string());
    }
    
    if !full_path.extension().map_or(false, |ext| ext == "py") {
        return Err("Only Python files can be executed".to_string());
    }
    
    if !full_path.exists() {
        return Err("File not found".to_string());
    }
    
    // Start timing
    let start_time = Instant::now();
    
    // Prepare Python command
    let mut cmd = Command::new("python3");
    cmd.arg(&full_path)
        .current_dir(&workspace_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONPATH", workspace_path.to_str().unwrap_or("."));
    
    // Add dataset as environment variable if provided
    if let Some(dataset_name) = dataset {
        cmd.env("TEST_DATASET", dataset_name);
    }
    
    // Add additional environment variables if provided
    if let Some(env_vars) = env_vars {
        for (key, value) in env_vars {
            cmd.env(key, value);
        }
    }
    
    // Emit start event
    window.emit("component-run-start", serde_json::json!({
        "file": file_path,
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string()
    })).ok();
    
    // Spawn the process
    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to start Python: {}. Make sure Python 3 is installed.", e))?;
    
    // Get stdout and stderr
    let stdout = child.stdout.take()
        .ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take()
        .ok_or("Failed to capture stderr")?;
    
    let mut output_lines = 0;
    let mut error_lines = 0;
    
    // Create readers
    let stdout_reader = BufReader::new(stdout);
    let stderr_reader = BufReader::new(stderr);
    
    // Clone window for tasks
    let window_stdout = window.clone();
    let window_stderr = window.clone();
    
    // Task to read stdout
    let stdout_task = tokio::spawn(async move {
        let mut lines = stdout_reader.lines();
        let mut count = 0;
        
        while let Ok(Some(line)) = lines.next_line().await {
            window_stdout.emit("component-output", serde_json::json!({
                "type": "stdout",
                "line": line,
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string()
            })).ok();
            count += 1;
        }
        count
    });
    
    // Task to read stderr
    let stderr_task = tokio::spawn(async move {
        let mut lines = stderr_reader.lines();
        let mut count = 0;
        
        while let Ok(Some(line)) = lines.next_line().await {
            window_stderr.emit("component-output", serde_json::json!({
                "type": "stderr", 
                "line": line,
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string()
            })).ok();
            count += 1;
        }
        count
    });
    
    // Wait for process with timeout
    let timeout = tokio::time::Duration::from_secs(30);
    let status = tokio::time::timeout(timeout, child.wait()).await;
    
    let success = match status {
        Ok(Ok(status)) => status.success(),
        Ok(Err(e)) => {
            window.emit("component-output", serde_json::json!({
                "type": "error",
                "line": format!("Process error: {}", e),
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string()
            })).ok();
            false
        },
        Err(_) => {
            // Timeout - kill the process
            child.kill().await.ok();
            window.emit("component-output", serde_json::json!({
                "type": "error",
                "line": "Process timed out after 30 seconds",
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string()
            })).ok();
            false
        }
    };
    
    // Wait for output tasks to complete
    output_lines = stdout_task.await.unwrap_or(0);
    error_lines = stderr_task.await.unwrap_or(0);
    
    let execution_time_ms = start_time.elapsed().as_millis() as f64;
    
    // Emit completion event
    window.emit("component-run-complete", serde_json::json!({
        "file": file_path,
        "success": success,
        "execution_time_ms": execution_time_ms,
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string()
    })).ok();
    
    Ok(RunResult {
        success,
        execution_time_ms,
        output_lines,
        error_lines,
    })
}

#[derive(Debug, Serialize)]
pub struct ChartData {
    time: Vec<String>,
    open: Vec<f64>,
    high: Vec<f64>,
    low: Vec<f64>,
    close: Vec<f64>,
}

#[tauri::command]
pub async fn load_parquet_data(dataset_name: String) -> Result<ChartData, String> {
    // Validate dataset name
    if dataset_name.contains("..") || dataset_name.contains("/") || dataset_name.contains("\\") {
        return Err("Invalid dataset name".to_string());
    }
    
    // Get the path to the data directory
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let data_path = current_dir.parent()
        .ok_or("Failed to get parent directory")?
        .join("workspace")
        .join("data")
        .join(&dataset_name);
    
    // Check if file exists
    if !data_path.exists() {
        return Err(format!("Dataset file not found: {}", dataset_name));
    }
    
    // Open the parquet file
    let file = File::open(&data_path)
        .map_err(|e| format!("Failed to open parquet file: {}", e))?;
    
    // Use Arrow reader for better schema handling
    let builder = ParquetRecordBatchReaderBuilder::try_new(file)
        .map_err(|e| format!("Failed to create parquet reader: {}", e))?;
    
    let mut reader = builder.build()
        .map_err(|e| format!("Failed to build reader: {}", e))?;
    
    let mut times = Vec::new();
    let mut opens = Vec::new();
    let mut highs = Vec::new();
    let mut lows = Vec::new();
    let mut closes = Vec::new();
    
    // Limit to first 1000 rows for performance
    const MAX_ROWS: usize = 1000;
    let mut total_rows = 0;
    
    // Read batches
    while let Some(batch_result) = reader.next() {
        let batch = batch_result.map_err(|e| format!("Failed to read batch: {}", e))?;
        
        // Get column indices by name
        let schema = batch.schema();
        let time_col_idx = schema.fields().iter().position(|f| f.name() == "timestamp" || f.name() == "time")
            .ok_or("No timestamp/time column found")?;
        let open_col_idx = schema.fields().iter().position(|f| f.name() == "open")
            .ok_or("No open column found")?;
        let high_col_idx = schema.fields().iter().position(|f| f.name() == "high")
            .ok_or("No high column found")?;
        let low_col_idx = schema.fields().iter().position(|f| f.name() == "low")
            .ok_or("No low column found")?;
        let close_col_idx = schema.fields().iter().position(|f| f.name() == "close")
            .ok_or("No close column found")?;
        
        // Get arrays from batch
        let time_array = batch.column(time_col_idx);
        let open_array = batch.column(open_col_idx).as_any()
            .downcast_ref::<Float64Array>()
            .ok_or("Open column is not Float64")?;
        let high_array = batch.column(high_col_idx).as_any()
            .downcast_ref::<Float64Array>()
            .ok_or("High column is not Float64")?;
        let low_array = batch.column(low_col_idx).as_any()
            .downcast_ref::<Float64Array>()
            .ok_or("Low column is not Float64")?;
        let close_array = batch.column(close_col_idx).as_any()
            .downcast_ref::<Float64Array>()
            .ok_or("Close column is not Float64")?;
        
        // Process rows in this batch
        let batch_rows = batch.num_rows().min(MAX_ROWS - total_rows);
        
        for i in 0..batch_rows {
            // Handle time column (could be timestamp or string)
            let time_str = if let Some(ts_array) = time_array.as_any().downcast_ref::<TimestampMillisecondArray>() {
                if ts_array.is_null(i) {
                    continue;
                }
                let timestamp = ts_array.value(i);
                let datetime = chrono::DateTime::from_timestamp_millis(timestamp)
                    .ok_or("Invalid timestamp")?;
                datetime.format("%Y-%m-%d %H:%M:%S").to_string()
            } else if let Some(str_array) = time_array.as_any().downcast_ref::<StringArray>() {
                if str_array.is_null(i) {
                    continue;
                }
                str_array.value(i).to_string()
            } else {
                continue;
            };
            
            // Get OHLC values
            if !open_array.is_null(i) && !high_array.is_null(i) && 
               !low_array.is_null(i) && !close_array.is_null(i) {
                times.push(time_str);
                opens.push(open_array.value(i));
                highs.push(high_array.value(i));
                lows.push(low_array.value(i));
                closes.push(close_array.value(i));
            }
        }
        
        total_rows += batch_rows;
        if total_rows >= MAX_ROWS {
            break;
        }
    }
    
    if times.is_empty() {
        return Err("No valid data found in parquet file".to_string());
    }
    
    Ok(ChartData {
        time: times,
        open: opens,
        high: highs,
        low: lows,
        close: closes,
    })
}