# Component Metadata Architecture

## Implementation Status
**Core System Complete** ✅ - The metadata system is fully operational with:
- Real-time status management (prototype/in_progress/ready)
- Dynamic category discovery from file system
- Component scanning and metadata extraction
- File and folder management with right-click actions
- IDE integration with live metadata editing

## Table of Contents
1. [Overview](#overview)
2. [Core Philosophy](#core-philosophy)
3. [Architecture Design](#architecture-design)
4. [Implementation Specification](#implementation-specification)
5. [Code Examples](#code-examples)
6. [Backend Implementation](#backend-implementation)
7. [Frontend Integration](#frontend-integration)
8. [Developer Workflow](#developer-workflow)
9. [Current Status](#current-status)
10. [Performance Considerations](#performance-considerations)
11. [Future Enhancements](#future-enhancements)

---

## Overview

The Component Metadata Architecture is an approach to managing trading system components where **code is the single source of truth**. Metadata lives directly in the Python/YAML files and is extracted for display in the UI.

### What's Built
- **Status Management**: Three-state selector (prototype/in_progress/ready) in IDE header updates metadata in real-time
- **Component Discovery**: Rust backend scans workspace and extracts metadata without executing code
- **Dynamic Categories**: File system structure defines categories, custom folders automatically appear as new categories
- **File Operations**: Right-click context menu for delete/rename on both files and custom category folders
- **Build Page Integration**: Shows real components with status badges, counts, and filtering
- **Metadata Updates**: Regex-based updates preserve code formatting while changing metadata fields

---

## Core Philosophy

### 1. Code as Truth
```python
# The metadata is IN the file, not about the file
__metadata__ = {
    'name': 'adaptive_rsi',
    'category': 'momentum',
    'version': '2.1.0'
}
```

### 2. Static vs Dynamic Separation
- **Static Metadata**: What the developer declares (name, category, version)
- **Dynamic Metadata**: What the system measures (performance, usage, test results)

### 3. Progressive Enhancement
Start simple, add complexity as needed without breaking existing components.

---

## Architecture Design

```
┌─────────────────┐
│   Python File   │  ← Developer writes code with __metadata__ dict
│  __metadata__   │
└────────┬────────┘
         │ File System
         ▼
┌─────────────────┐
│  Rust Backend   │  ← workspace.rs module
│ • scan_component│    • Regex extraction
│ • save_file     │    • Path validation  
│ • delete/rename │    • Category discovery
└────────┬────────┘
         │ Tauri Commands
         ▼
┌─────────────────┐
│   React UI      │  
│ • Build Page    │  ← Component library
│ • Monaco IDE    │  ← Edit with status selector
└─────────────────┘
```

### Implementation Details

1. **Component Discovery**
   - `get_workspace_components` command in workspace.rs
   - Recursively scans workspace directories
   - Extracts metadata via regex without code execution
   - Returns ComponentInfo structs with name, type, category, path, status

2. **Status Management**
   - Dropdown selector in IDE header
   - Updates __metadata__['status'] field in Python code
   - Preserves formatting and indentation
   - Falls back gracefully if metadata structure is incomplete

3. **File Management**
   - Right-click context menu on file tree items
   - Delete: Removes file, clears editor if currently open
   - Rename: Modal with validation, updates file tree
   - Folder operations limited to custom indicator categories
   - Default categories (momentum, trend, etc.) are protected

4. **Build Page Integration**
   - Fetches real components on mount
   - Displays counts by type and status
   - Color-coded status badges (red/yellow/green)
   - Search and filter functionality persists via BuildContext

---

## Implementation Specification

### Metadata Schema Version 1.0

```python
from typing import TypedDict, List, Optional, Dict, Any

class ComponentMetadata(TypedDict):
    # Required fields
    name: str                    # Unique identifier
    category: str               # momentum|trend|volatility|volume|custom
    version: str                # Semantic version
    
    # Optional fields
    description: Optional[str]   # One-line description
    author: Optional[str]       # Git username or custom
    created: Optional[str]      # ISO date
    modified: Optional[str]     # ISO date (auto-updated)
    
    # Component-specific
    inputs: Optional[List[str]] # ['close', 'volume']
    outputs: Optional[List[str]] # ['value', 'signal']
    parameters: Optional[Dict[str, Dict[str, Any]]]
    
    # Performance hints
    performance_budget: Optional[Dict[str, float]]  # {'max_ms': 1.0}
    min_lookback: Optional[int]  # Minimum bars needed
    
    # Discovery
    tags: Optional[List[str]]    # ['oversold', 'divergence']
    market_conditions: Optional[List[str]]  # ['trending', 'volatile']
    
    # Lineage
    based_on: Optional[str]      # Parent component
    breaking_changes: Optional[List[str]]
```

### Categories Definition

```python
VALID_CATEGORIES = {
    'indicators': ['momentum', 'trend', 'volatility', 'volume', 'microstructure'],
    'signals': ['entry', 'exit', 'filter', 'confirmation'],
    'orders': ['market', 'limit', 'iceberg', 'twap', 'vwap'],
    'strategies': ['trend_following', 'mean_reversion', 'arbitrage', 'ml_based']
}
```

---

## Code Examples

### Indicator Example

```python
"""
Adaptive RSI - Dynamically adjusts period based on market volatility
"""
from typing import Optional
import numpy as np
import pandas as pd
from core.base import Indicator

__metadata_version__ = 1
__metadata__ = {
    'name': 'adaptive_rsi',
    'category': 'momentum',
    'version': '2.1.0',
    'description': 'RSI that adjusts period based on volatility',
    'author': 'quantum_trader',
    'inputs': ['close'],
    'outputs': ['rsi', 'signal_line'],
    'parameters': {
        'base_period': {
            'type': 'int',
            'default': 14,
            'min': 2,
            'max': 100,
            'description': 'Base RSI period'
        },
        'volatility_lookback': {
            'type': 'int',
            'default': 20,
            'min': 10,
            'max': 50
        }
    },
    'performance_budget': {
        'max_ms': 1.0,
        'complexity': 'O(n)'
    },
    'min_lookback': 30,
    'tags': ['adaptive', 'momentum', 'oversold', 'overbought'],
    'market_conditions': ['ranging', 'volatile']
}

class AdaptiveRSI(Indicator):
    """
    RSI that dynamically adjusts its period based on recent volatility.
    Higher volatility = shorter period (more responsive)
    Lower volatility = longer period (more stable)
    """
    
    def __init__(self, base_period: int = 14, volatility_lookback: int = 20):
        super().__init__()
        self.base_period = base_period
        self.volatility_lookback = volatility_lookback
        
    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        """Calculate adaptive RSI values"""
        close = data['close']
        
        # Calculate volatility
        returns = close.pct_change()
        volatility = returns.rolling(self.volatility_lookback).std()
        
        # Normalize volatility to adjust period
        vol_rank = volatility.rank(pct=True)
        adaptive_period = self.base_period * (2 - vol_rank)
        adaptive_period = adaptive_period.clip(lower=2, upper=50).astype(int)
        
        # Calculate RSI with adaptive period
        # ... implementation details ...
        
        return pd.DataFrame({
            'rsi': rsi_values,
            'signal_line': signal_line
        })
```

### Signal Example

```python
"""
Momentum Confluence Signal - Multiple momentum indicators alignment
"""
from typing import Dict
import pandas as pd
from core.base import Signal

__metadata_version__ = 1
__metadata__ = {
    'name': 'momentum_confluence',
    'category': 'entry',
    'version': '1.3.0',
    'description': 'Triggers when multiple momentum indicators align',
    'inputs': ['close', 'volume'],
    'outputs': ['signal', 'strength'],
    'required_indicators': ['adaptive_rsi', 'macd', 'momentum_wave'],
    'parameters': {
        'min_confluence': {
            'type': 'int',
            'default': 2,
            'min': 2,
            'max': 4,
            'description': 'Minimum indicators that must agree'
        },
        'rsi_oversold': {'type': 'float', 'default': 30.0},
        'rsi_overbought': {'type': 'float', 'default': 70.0}
    },
    'tags': ['confluence', 'momentum', 'high_probability'],
    'market_conditions': ['trending'],
    'backtest_stats': {
        'win_rate': 0.68,
        'avg_return': 0.023,
        'sharpe': 1.85
    }
}

class MomentumConfluence(Signal):
    """
    Generates signals when multiple momentum indicators agree on direction.
    Higher confluence = stronger signal.
    """
    
    def evaluate(self, data: pd.DataFrame, indicators: Dict[str, pd.Series]) -> pd.DataFrame:
        # Signal logic here
        pass
```

### Order Example

```python
"""
Iceberg Plus - Enhanced iceberg order with anti-detection
"""
from typing import Dict, Optional
from core.base import OrderExecutor

__metadata_version__ = 1
__metadata__ = {
    'name': 'iceberg_plus',
    'category': 'iceberg',
    'version': '3.0.1',
    'description': 'Iceberg orders with randomization to avoid detection',
    'parameters': {
        'visible_ratio': {
            'type': 'float',
            'default': 0.1,
            'min': 0.05,
            'max': 0.3,
            'description': 'Portion of order visible to market'
        },
        'randomize_size': {'type': 'bool', 'default': True},
        'min_interval_ms': {'type': 'int', 'default': 500}
    },
    'venues': ['binance', 'coinbase', 'kraken'],
    'order_types': ['limit', 'limit_maker'],
    'performance_budget': {'max_latency_ms': 50},
    'tags': ['stealth', 'large_orders', 'low_impact']
}

class IcebergPlus(OrderExecutor):
    """
    Splits large orders into smaller visible chunks with randomization
    to avoid detection by other algorithms.
    """
    
    def execute(self, order_request: Dict) -> Dict:
        # Execution logic here
        pass
```

### Strategy Example (YAML)

```yaml
# momentum_hunter_v3.yaml
metadata_version: 1
metadata:
  name: momentum_hunter_v3
  category: trend_following  
  version: 3.2.0
  description: "Trend following with dynamic position sizing"
  author: alpha_seeker
  created: 2024-01-15
  tags: 
    - momentum
    - trend
    - dynamic_sizing
  market_conditions:
    - trending
    - low_volatility
  backtest_results:
    sharpe_ratio: 2.1
    max_drawdown: 0.15
    win_rate: 0.64

# Strategy configuration
dependencies:
  indicators:
    - adaptive_rsi: {base_period: 14}
    - trend_strength: {period: 50}
    - volume_profile: {bins: 20}
  
  signals:
    - momentum_confluence:
        min_confluence: 3
        strict_mode: true
    
  orders:
    - iceberg_plus:
        visible_ratio: 0.15
        randomize_size: true

parameters:
  position_sizing:
    method: kelly_criterion
    max_position: 0.25
    scale_by_volatility: true
    
  risk_management:
    stop_loss: 0.02
    trailing_stop: true
    max_correlated_positions: 3
    
  filters:
    min_volume_usd: 1000000
    max_spread_bps: 10
    avoid_news_hours: true

execution:
  rebalance_frequency: 1h
  slippage_model: dynamic
  commission_bps: 10
```

---

## Backend Implementation

### File Watcher Service (Rust)

```rust
use notify::{Watcher, RecursiveMode, Result};
use std::sync::mpsc::channel;
use std::path::Path;

pub struct MetadataWatcher {
    watcher: Box<dyn Watcher>,
    workspace_path: PathBuf,
}

impl MetadataWatcher {
    pub fn new(workspace_path: &str) -> Result<Self> {
        let (tx, rx) = channel();
        
        let mut watcher = notify::recommended_watcher(move |res| {
            tx.send(res).unwrap();
        })?;
        
        watcher.watch(Path::new(workspace_path), RecursiveMode::Recursive)?;
        
        // Spawn handler thread
        tauri::async_runtime::spawn(async move {
            while let Ok(event) = rx.recv() {
                match event {
                    Ok(event) => handle_file_change(event).await,
                    Err(e) => log::error!("Watch error: {:?}", e),
                }
            }
        });
        
        Ok(Self { watcher, workspace_path: workspace_path.into() })
    }
}

async fn handle_file_change(event: notify::Event) {
    use notify::EventKind;
    
    match event.kind {
        EventKind::Create(_) | EventKind::Modify(_) => {
            for path in event.paths {
                if path.extension() == Some("py") || path.extension() == Some("yaml") {
                    if let Err(e) = process_component_file(&path).await {
                        log::error!("Failed to process {}: {:?}", path.display(), e);
                    }
                }
            }
        }
        _ => {}
    }
}
```

### Python AST Parser

```python
# metadata_parser.py
import ast
import yaml
from pathlib import Path
from typing import Dict, Any, Optional

class MetadataExtractor:
    """Extract metadata from Python and YAML files using AST parsing"""
    
    def extract_from_file(self, file_path: Path) -> Optional[Dict[str, Any]]:
        """Extract metadata from a component file"""
        if file_path.suffix == '.py':
            return self._extract_from_python(file_path)
        elif file_path.suffix in ['.yaml', '.yml']:
            return self._extract_from_yaml(file_path)
        return None
    
    def _extract_from_python(self, file_path: Path) -> Optional[Dict[str, Any]]:
        """Extract metadata from Python file using AST"""
        try:
            content = file_path.read_text()
            tree = ast.parse(content)
            
            metadata = None
            metadata_version = 1
            
            # Walk the AST
            for node in ast.walk(tree):
                # Look for __metadata__ assignment
                if isinstance(node, ast.Assign):
                    for target in node.targets:
                        if isinstance(target, ast.Name):
                            if target.id == '__metadata__':
                                # Safely evaluate the literal
                                metadata = ast.literal_eval(node.value)
                            elif target.id == '__metadata_version__':
                                metadata_version = ast.literal_eval(node.value)
                
                # Also extract from decorators
                elif isinstance(node, ast.ClassDef):
                    for decorator in node.decorator_list:
                        if isinstance(decorator, ast.Call):
                            if getattr(decorator.func, 'id', None) == 'component_metadata':
                                # Extract from decorator
                                if decorator.args:
                                    metadata = ast.literal_eval(decorator.args[0])
            
            if metadata:
                # Add file info
                metadata['_file_path'] = str(file_path)
                metadata['_metadata_version'] = metadata_version
                metadata['_component_type'] = self._determine_component_type(file_path)
                
                # Extract additional info
                metadata['_imports'] = self._extract_imports(tree)
                metadata['_classes'] = self._extract_classes(tree)
                
                return metadata
                
        except Exception as e:
            print(f"Error parsing {file_path}: {e}")
            return None
    
    def _extract_imports(self, tree: ast.AST) -> List[Dict[str, Any]]:
        """Extract import statements for dependency tracking"""
        imports = []
        
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if node.module and node.module.startswith('core.'):
                    imports.append({
                        'module': node.module,
                        'names': [alias.name for alias in node.names]
                    })
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    imports.append({
                        'module': alias.name,
                        'names': []
                    })
        
        return imports
    
    def _extract_classes(self, tree: ast.AST) -> List[str]:
        """Extract class names from the file"""
        return [node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
    
    def _determine_component_type(self, file_path: Path) -> str:
        """Determine component type from file path"""
        # Future implementation would continue here...
```

---

## Frontend Integration

### Build Page Implementation

The Build Page fetches and displays real components:

```typescript
// Fetch real components on mount
useEffect(() => {
  const fetchComponents = async () => {
    try {
      const components = await invoke<ComponentInfo[]>('get_workspace_components');
      
      // Transform into display format
      const byType = components.reduce((acc, comp) => {
        if (!acc[comp.component_type]) {
          acc[comp.component_type] = [];
        }
        acc[comp.component_type].push({
          name: comp.name,
          path: comp.path,
          status: comp.status,
          category: comp.category
        });
        return acc;
      }, {} as Record<string, any[]>);
      
      setIndicators(byType.indicator || []);
      setSignals(byType.signal || []);
      setOrders(byType.order || []);
      setStrategies(byType.strategy || []);
    } catch (error) {
      console.error('Failed to fetch components:', error);
    }
  };
  
  fetchComponents();
}, []);
```

### IDE Status Management

The Monaco IDE includes a status selector that updates metadata in real-time:

```typescript
// Status selector in IDE header
<Select
  value={componentStatus}
  onChange={handleStatusChange}
  data={[
    { value: 'prototype', label: 'Prototype' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'ready', label: 'Ready' }
  ]}
/>

// Update metadata in code
const handleStatusChange = (newStatus: string | null) => {
  if (!newStatus || !selectedFile) return;
  
  const updatedCode = code.replace(
    /'status':\s*'[^']*'/,
    `'status': '${newStatus}'`
  );
  
  setCode(updatedCode);
  setComponentStatus(newStatus);
};
```

### Context Menu Implementation

```typescript
// Right-click handler
const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
  e.preventDefault();
  e.stopPropagation();
  
  setContextMenuPosition({ x: e.clientX, y: e.clientY });
  setContextMenuFile(node);
  setContextMenuOpened(true);
};

// Menu actions
const handleDelete = async () => {
  if (node.type === 'file') {
    await invoke('delete_component_file', { filePath: node.path });
  } else {
    await invoke('delete_component_folder', { folderPath: node.path });
  }
  refreshFileTree();
};
```

---

## Developer Workflow

### Creating Components

1. **Choose Component Type**: Select from Build page or IDE
2. **Edit Metadata**: Fill in required fields in __metadata__ dict
3. **Set Status**: Use dropdown to mark as prototype/in_progress/ready
4. **Save**: Metadata updates are reflected immediately in Build page

### Managing Components

1. **Rename**: Right-click file → Rename
2. **Delete**: Right-click file → Delete (clears editor if open)
3. **Create Category**: Make new folder under /core/indicators/
4. **Move Component**: Cut/paste file to new category folder

### Best Practices

1. **Always include core metadata fields**: name, category, version, description, author, status
2. **Use semantic versioning**: Major.Minor.Patch (e.g., "1.2.3")
3. **Keep status updated**: Mark as 'ready' only when fully tested
4. **Document parameters**: Include type, default, min/max, description
5. **Tag appropriately**: Use consistent tags for discovery

---

## Summary

The Component Metadata Architecture provides a simple yet powerful system for managing trading components. By keeping metadata in the code files themselves, we ensure it never gets out of sync. The current implementation handles status management, dynamic categories, and file operations - providing a solid foundation for a trading component library.

### Key Achievements
- **Zero Configuration**: Components self-describe via __metadata__
- **Real-time Updates**: Changes instantly reflected in UI
- **Type Safety**: Rust backend validates all operations
- **Developer Friendly**: Simple Python dicts, no complex schemas
- **Scalable Design**: Ready for SQLite when needed

### Next Steps
The architecture is designed to grow with your needs. When you have hundreds of components and need advanced search, the SQLite cache layer can be added without changing any component files. When you need dependency tracking, the AST parser can extract imports automatically. The foundation is built for the future while keeping things simple today.
                category = excluded.category,
                version = excluded.version,
                file_path = excluded.file_path,
                metadata_json = excluded.metadata_json,
                file_hash = excluded.file_hash,
                last_parsed = CURRENT_TIMESTAMP
            RETURNING id
            "#,
            name,
            component_type,
            category,
            version,
            file_path,
            metadata.to_string(),
            compute_file_hash(file_path)
        )
        .fetch_one(&self.pool)
        .await?;
        
        Ok(result.id)
    }
    
    pub async fn search_components(&self, query: &str) -> Result<Vec<ComponentMetadata>, sqlx::Error> {
        let results = sqlx::query_as!(
            ComponentMetadata,
            r#"
            SELECT 
                m.*,
                p.avg_execution_ms as "avg_ms: f64",
                p.p95_execution_ms as "p95_ms: f64",
                p.p99_execution_ms as "p99_ms: f64",
                m.usage_count,
                m.used_by_strategies
            FROM component_metadata m
            LEFT JOIN (
                SELECT 
                    component_id,
                    AVG(execution_time_ms) as avg_execution_ms,
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) as p95_execution_ms,
                    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY execution_time_ms) as p99_execution_ms
                FROM performance_metrics
                WHERE measured_at > datetime('now', '-7 days')
                GROUP BY component_id
            ) p ON m.id = p.component_id
            WHERE m.name LIKE ?1 
               OR m.description LIKE ?1 
               OR m.tags LIKE ?1
            ORDER BY m.usage_count DESC, m.name
            "#,
            format!("%{}%", query)
        )
        .fetch_all(&self.pool)
        .await?;
        
        Ok(results)
    // Future implementation continues...
}
```
          label="Type"
          data={['all', 'indicator', 'signal', 'order', 'strategy']}
          value={filters.type}
          onChange={(value) => setFilters({ ...filters, type: value })}
        />
        
        <Select
          label="Performance"
          data={[
            { value: 'any', label: 'Any' },
            { value: 'fast', label: '< 1ms' },
            { value: 'medium', label: '1-5ms' },
            { value: 'slow', label: '> 5ms' }
          ]}
          value={filters.performance}
          onChange={(value) => setFilters({ ...filters, performance: value })}
        />
        
        <MultiSelect
          label="Tags"
          data={['momentum', 'trend', 'volatility', 'ml-based', 'adaptive']}
          value={filters.tags}
          onChange={(value) => setFilters({ ...filters, tags: value })}
        />
      </Group>
    </Stack>
  );
}
```

---

## Current Developer Workflow

### 1. Creating a New Component

In the IDE, click the "+" button in the file tree:
- Choose component type (indicator/signal/order/strategy)
- Enter filename
- Select or create category (for indicators)
- File is created with proper template and metadata

Template includes:
```python
"""
Super RSI - [Your description here]
"""

__metadata_version__ = 1
__metadata__ = {
    'name': 'super_rsi',
    'category': 'momentum',
    'version': '0.1.0',
    'description': '[Add description]',
    'author': '[git config user.name]',
    'created': '2024-01-20',
    'inputs': ['close'],
    'outputs': ['value'],
    'parameters': {
        'period': {
            'type': 'int',
            'default': 14,
            'min': 2,
            'max': 100
        }
    }
}

class SuperRSI(Indicator):
    def __init__(self, period: int = 14):
        super().__init__()
        self.period = period
    
    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        # TODO: Implement your indicator logic
        raise NotImplementedError("Implement your indicator calculation here")
```

### 2. Development Cycle

```
1. Edit file in Monaco IDE
   ↓
2. Change status via dropdown (prototype → in_progress → ready)
   ↓
3. Save file (metadata updated inline)
   ↓
4. Component appears in Build page with correct status
   ↓
5. Run component with play button
   ↓
6. Output appears in terminal panel
```

### 3. Metadata Management

**Current Metadata Fields**:
- `name`: Component identifier
- `category`: Type category (momentum, trend, etc.)
- `version`: Semantic version
- `description`: One-line description
- `author`: Component author
- `status`: Development status (prototype/in_progress/ready)
- `inputs`/`outputs`: For indicators and signals
- `parameters`: Component configuration

**Status Management**:
- Status dropdown in IDE header (only for Python files)
- Updates metadata in code immediately
- Build page reflects status with color badges:
  - 🟢 Ready (green)
  - 🟡 In Progress (yellow)
  - 🔵 Prototype (blue)
```

---

## Implemented Architecture

### Component Discovery
- Rust backend scans workspace directories
- Extracts metadata from `__metadata__` dictionaries
- Returns `ComponentInfo` structs with name, type, category, path, status
- No database needed for current scale

### File Management
- Right-click context menu for files and folders
- Delete operation clears editor if file is open
- Rename updates selected file path
- Custom category folders can be managed (not default ones)
- Folders must be empty before deletion

### UI Integration
- Build page fetches real components on mount
- Shows actual metadata (description, status)
- Live status updates via IDE dropdown
- Categories dynamically loaded from file system

### Migration Script Example

```python
# migrate_existing_components.py
import ast
import re
from pathlib import Path

def generate_metadata_for_file(file_path: Path) -> dict:
    """Generate initial metadata from existing file"""
    content = file_path.read_text()
    
    # Extract class name
    tree = ast.parse(content)
    classes = [node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
    
    if not classes:
        return None
    
    class_name = classes[0]
    
    # Guess category from path
    category = guess_category(file_path)
    
    # Extract docstring
    docstring = extract_docstring(tree, class_name)
    
    # Analyze code for inputs/outputs
    inputs, outputs = analyze_io(tree, class_name)
    
    return {
        'name': camel_to_snake(class_name),
        'category': category,
        'version': '1.0.0',  # Start at 1.0.0 for existing
        'description': docstring.split('\n')[0] if docstring else '',
        'inputs': inputs,
        'outputs': outputs,
        'migrated_from': 'legacy'
    }

def inject_metadata(file_path: Path, metadata: dict):
    """Inject metadata into existing file"""
    content = file_path.read_text()
    
    # Find the right place to insert (after imports, before class)
    lines = content.split('\n')
    insert_line = find_insert_position(lines)
    
    # Create metadata block
    metadata_block = [
        "",
        "__metadata_version__ = 1",
        "__metadata__ = " + repr(metadata),
        ""
    ]
    
    # Insert and write back
    lines[insert_line:insert_line] = metadata_block
    file_path.write_text('\n'.join(lines))
```

---

## Performance Considerations

### Caching Strategy

```rust
pub struct MetadataCache {
    // In-memory cache for hot path
    memory_cache: Arc<RwLock<HashMap<String, ComponentMetadata>>>,
    
    // SQLite for persistence
    db: MetadataStore,
    
    // File hash cache to avoid re-parsing
    file_hashes: Arc<RwLock<HashMap<PathBuf, String>>>,
}

impl MetadataCache {
    pub async fn get_component(&self, name: &str) -> Option<ComponentMetadata> {
        // Try memory first
        if let Some(component) = self.memory_cache.read().await.get(name) {
            return Some(component.clone());
        }
        
        // Fall back to DB
        if let Ok(component) = self.db.get_component(name).await {
            // Update memory cache
            self.memory_cache.write().await.insert(name.to_string(), component.clone());
            return Some(component);
        }
        
        None
    }
    
    pub async fn invalidate(&self, file_path: &Path) {
        // Remove from memory cache
        // Will be re-parsed on next access
    }
}
```

### Optimization Techniques

1. **Incremental Parsing**: Only re-parse changed files
2. **Batch Updates**: Group metadata updates in transactions
3. **Lazy Loading**: Don't parse until needed
4. **Background Processing**: Parse in separate thread
5. **Compression**: Store large metadata fields compressed

### Performance Targets

- File change → Metadata updated: < 100ms
- Search query → Results: < 50ms
- Component count for UI: < 10ms
- Full workspace scan: < 5s for 1000 files

---

## Future Enhancements

### 1. AI-Powered Discovery

```python
# "Find indicators similar to RSI but faster"
similar_components = await invoke('find_similar', {
    'reference': 'rsi',
    'constraints': {
        'performance': '< 0.5ms',
        'category': 'momentum'
    }
})
```

### 2. Component Marketplace

```yaml
# Publish component
$ sptrader publish adaptive_rsi --public

# Discover community components
$ sptrader search "volatility breakout" --community
```

### 3. Automated Optimization

```python
# System suggests optimizations based on usage patterns
__metadata__ = {
    'name': 'slow_indicator',
    'performance_budget': {'max_ms': 1.0},
    '_suggestions': [
        'Consider caching repeated calculations',
        'NumPy vectorization could improve line 45',
        'Similar to fast_indicator but 10x slower'
    ]
}
```

### 4. Visual Dependency Explorer

```
┌─ momentum_strategy
├─── momentum_signal
│    ├── adaptive_rsi
│    └── trend_strength
└─── iceberg_order
     └── uses: momentum_signal
```

### 5. Component Versioning & Compatibility

```python
__metadata__ = {
    'name': 'adaptive_rsi',
    'version': '2.0.0',
    'compatible_with': {
        'momentum_signal': '>=1.2.0',
        'sptrader': '>=3.0.0'
    },
    'breaking_changes': [
        '2.0.0: Output range changed from 0-100 to 0-1'
    ]
}
```

### 6. Performance Regression Detection

```
⚠️ Performance Alert:
adaptive_rsi execution time increased 40% in last commit
- Previous: 0.8ms average
- Current: 1.12ms average
- Regression at line 45: new_calculation()
[View Diff] [Revert] [Accept]
```

### 7. Intelligent Component Suggestions

```python
# Based on current strategy
suggested_components = [
    {
        'name': 'volume_confirmation',
        'reason': 'Your momentum signals have 68% accuracy, adding volume confirmation typically improves to 75%+',
        'integration_effort': 'low'
    }
]
```

---

## Current Status

### ✅ Implemented
1. **Basic Metadata System**: Components have `__metadata__` dictionaries
2. **Status Management**: Dropdown in IDE to set prototype/in_progress/ready
3. **Dynamic Categories**: File system based, with custom category support
4. **Component Discovery**: Real components shown in Build page
5. **File Management**: Right-click delete/rename for files and folders
6. **Templates**: All component types have proper metadata templates

### 🚧 Planned (Future Phases)
1. **Performance Tracking**: Measure actual execution times
2. **Dependency Tracking**: Track which components use which
3. **AST Parsing**: Replace regex with proper Python AST parsing
4. **SQLite Cache**: For fast queries when scaling to 100+ components
5. **File Watching**: Auto-update on external file changes
6. **Validation Engine**: Schema validation for metadata
7. **Git Integration**: Show component history and changes

The current implementation provides a solid foundation where **code is the single source of truth**, with room to grow as the system scales.