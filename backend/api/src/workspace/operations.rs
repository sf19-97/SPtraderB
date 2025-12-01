use super::{ComponentInfo, FileNode};
use std::fs;
use std::path::{Path, PathBuf};

// ============================================================================
// File Tree Building (recursive, complex)
// ============================================================================

pub fn build_file_tree(path: &Path, base_path: &Path) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();

    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();

        if let Some(node) = build_file_node(&entry_path, base_path)? {
            nodes.push(node);
        }
    }

    // Sort: folders first, then files, alphabetically
    nodes.sort_by(|a, b| match (a.node_type.as_str(), b.node_type.as_str()) {
        ("folder", "file") => std::cmp::Ordering::Less,
        ("file", "folder") => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(nodes)
}

fn build_file_node(path: &Path, base_path: &Path) -> Result<Option<FileNode>, String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?
        .to_string();

    // Skip hidden files and __pycache__
    if name.starts_with('.') || name == "__pycache__" {
        return Ok(None);
    }

    let relative_path = path
        .strip_prefix(base_path)
        .map_err(|e| e.to_string())?
        .to_str()
        .ok_or("Invalid path")?
        .replace('\\', "/");

    if path.is_dir() {
        let children = build_file_tree(path, base_path)?;
        Ok(Some(FileNode {
            name,
            path: relative_path,
            node_type: "folder".to_string(),
            children: Some(children),
        }))
    } else if path.is_file() {
        // Only include Python and YAML files
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        if matches!(extension, "py" | "yaml" | "yml") {
            Ok(Some(FileNode {
                name,
                path: relative_path,
                node_type: "file".to_string(),
                children: None,
            }))
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}

// ============================================================================
// Component Scanning (recursive with metadata parsing)
// ============================================================================

pub fn scan_workspace_components(workspace_path: &Path) -> Result<Vec<ComponentInfo>, String> {
    let mut components = Vec::new();

    // Scan indicators
    let indicators_path = workspace_path.join("core").join("indicators");
    if indicators_path.exists() {
        scan_component_directory(
            &indicators_path,
            workspace_path,
            "indicator",
            &mut components,
        )?;
    }

    // Scan signals
    let signals_path = workspace_path.join("core").join("signals");
    if signals_path.exists() {
        scan_component_directory(&signals_path, workspace_path, "signal", &mut components)?;
    }

    // Scan strategies (YAML files)
    let strategies_path = workspace_path.join("strategies");
    if strategies_path.exists() {
        for entry in fs::read_dir(&strategies_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if matches!(ext, "yaml" | "yml") {
                    if let Some(name) = path.file_stem().and_then(|n| n.to_str()) {
                        let relative_path = path
                            .strip_prefix(workspace_path)
                            .map_err(|e| e.to_string())?
                            .to_str()
                            .ok_or("Invalid path")?
                            .replace('\\', "/");

                        components.push(ComponentInfo {
                            name: name.to_string(),
                            component_type: "strategy".to_string(),
                            category: "strategy".to_string(),
                            path: relative_path,
                            has_metadata: true,
                            status: "ready".to_string(),
                        });
                    }
                }
            }
        }
    }

    // Sort by type and name
    components.sort_by(|a, b| {
        a.component_type
            .cmp(&b.component_type)
            .then(a.name.cmp(&b.name))
    });

    Ok(components)
}

fn scan_component_directory(
    dir_path: &Path,
    workspace_path: &Path,
    component_type: &str,
    components: &mut Vec<ComponentInfo>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            // Recursive scan
            scan_component_directory(&path, workspace_path, component_type, components)?;
        } else if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext == "py" {
                if let Some(name) = path.file_stem().and_then(|n| n.to_str()) {
                    // Skip test files and __init__.py
                    if name.starts_with("test_") || name == "__init__" {
                        continue;
                    }

                    // Determine category from parent directory
                    let category = path
                        .parent()
                        .and_then(|p| p.file_name())
                        .and_then(|n| n.to_str())
                        .unwrap_or("uncategorized")
                        .to_string();

                    let relative_path = path
                        .strip_prefix(workspace_path)
                        .map_err(|e| e.to_string())?
                        .to_str()
                        .ok_or("Invalid path")?
                        .replace('\\', "/");

                    // Parse metadata and status
                    let (has_metadata, status) = parse_component_metadata(&path);

                    components.push(ComponentInfo {
                        name: name.to_string(),
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

fn parse_component_metadata(path: &Path) -> (bool, String) {
    if let Ok(content) = fs::read_to_string(path) {
        let has_metadata = content.contains("__metadata__");

        let status = if has_metadata {
            // Extract status from metadata (simple string search)
            if let Some(start) = content
                .find("'status': '")
                .or_else(|| content.find("\"status\": \""))
            {
                let offset = if content[start..].starts_with("'status'") {
                    11
                } else {
                    11
                };
                let status_start = start + offset;
                let quote_char = if content[start..].starts_with("'") {
                    '\''
                } else {
                    '"'
                };

                if let Some(end) = content[status_start..].find(quote_char) {
                    return (
                        has_metadata,
                        content[status_start..status_start + end].to_string(),
                    );
                }
            }
            "prototype".to_string()
        } else {
            "prototype".to_string()
        };

        (has_metadata, status)
    } else {
        (false, "prototype".to_string())
    }
}

// ============================================================================
// Component Templates (inline strings, extracted for reuse)
// ============================================================================

pub fn get_component_template(component_type: &str) -> Result<String, String> {
    match component_type {
        "indicator" => Ok(INDICATOR_TEMPLATE.to_string()),
        "signal" => Ok(SIGNAL_TEMPLATE.to_string()),
        "strategy" => Ok(STRATEGY_TEMPLATE.to_string()),
        _ => Err(format!("Unknown component type: {}", component_type)),
    }
}

const INDICATOR_TEMPLATE: &str = r#""""
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
        return pd.DataFrame({'value': pd.Series(dtype=float)})

    @property
    def metadata(self) -> Dict[str, Any]:
        return __metadata__
"#;

const SIGNAL_TEMPLATE: &str = r#""""
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
        return pd.Series([False] * len(data), index=data.index)

    @property
    def metadata(self) -> Dict[str, Any]:
        return __metadata__
"#;

const STRATEGY_TEMPLATE: &str = r#"name: new_strategy
type: strategy
version: 0.1.0
author: system
description: TODO Add strategy description

# Import components
dependencies:
  indicators:
    # - core.indicators.momentum.rsi
  signals:
    # - core.signals.entry.oversold

# Strategy parameters
parameters:
  position_size: 0.01
  max_positions: 1
  stop_loss: 0.02
  take_profit: 0.04

# Risk management
risk:
  max_drawdown: 0.10
  daily_loss_limit: 0.02
  position_limit: 0.05

# Entry conditions
entry:
  # TODO: Define entry logic

# Exit conditions
exit:
  # TODO: Define exit logic
"#;
