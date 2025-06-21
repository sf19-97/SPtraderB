import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { Box, Group, Text, ActionIcon, Button, Stack, UnstyledButton, ScrollArea, Loader, Modal, TextInput, Select } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { 
  IconChevronLeft, 
  IconDeviceFloppy, 
  IconPlayerPlay, 
  IconFile, 
  IconFolder,
  IconFolderOpen,
  IconPlus,
  IconFileCode,
  IconJson,
  IconQuestionMark,
  IconX,
  IconRefresh,
  IconEdit,
  IconTrash,
  IconDatabase,
  IconDownload
} from '@tabler/icons-react';
import { useBuild } from '../contexts/BuildContext';
import { IDEHelpModal } from './IDEHelpModal';
import { PreviewChart } from './PreviewChart';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

export const MonacoIDE = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setLastOpenedComponent, addToRecentComponents } = useBuild();
  
  const type = searchParams.get('type') || 'indicator';
  const fileName = searchParams.get('file') || 'new';
  const filePath = searchParams.get('path') || '';
  
  const [code, setCode] = useState('');
  const [selectedFile, setSelectedFile] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [helpOpened, setHelpOpened] = useState(false);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [createFileOpened, setCreateFileOpened] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileCategory, setNewFileCategory] = useState<string>('momentum');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [componentStatus, setComponentStatus] = useState<string>('prototype');
  const [isRunning, setIsRunning] = useState(false);
  
  // Resizable dimensions
  const [fileTreeWidth, setFileTreeWidth] = useState(250);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [isResizingFileTree, setIsResizingFileTree] = useState(false);
  const [isResizingTerminal, setIsResizingTerminal] = useState(false);
  
  // Context menu state
  const [contextMenuOpened, setContextMenuOpened] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [contextMenuFile, setContextMenuFile] = useState<FileNode | null>(null);
  
  // Rename modal state
  const [renameModalOpened, setRenameModalOpened] = useState(false);
  const [renameFileName, setRenameFileName] = useState('');
  
  // Delete confirmation modal state
  const [deleteModalOpened, setDeleteModalOpened] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<FileNode | null>(null);
  
  // Export data modal state
  const [exportModalOpened, setExportModalOpened] = useState(false);
  const [exportSymbol, setExportSymbol] = useState('EURUSD');
  const [exportTimeframe, setExportTimeframe] = useState('1h');
  const [exportStartDate, setExportStartDate] = useState<Date | null>(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [exportEndDate, setExportEndDate] = useState<Date | null>(new Date());
  const [exportFilename, setExportFilename] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [availableDatasets, setAvailableDatasets] = useState<string[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  
  // Chart and component output state
  const [chartData, setChartData] = useState<any>(null);
  const [componentOutput, setComponentOutput] = useState({
    lastValue: '--',
    signal: '--',
    execution: '--',
    dataPoints: '--'
  });
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  
  // Ref for terminal auto-scroll
  const terminalScrollRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll terminal when new output is added
  useEffect(() => {
    if (terminalScrollRef.current) {
      const scrollArea = terminalScrollRef.current.querySelector('.mantine-ScrollArea-viewport');
      if (scrollArea) {
        scrollArea.scrollTop = scrollArea.scrollHeight;
      }
    }
  }, [terminalOutput]);
  
  // Debug: Monitor context menu state
  useEffect(() => {
    console.log('[ContextMenu] State changed:', {
      opened: contextMenuOpened,
      file: contextMenuFile,
      position: contextMenuPosition
    });
  }, [contextMenuOpened, contextMenuFile, contextMenuPosition]);
  
  // Test: Add keyboard shortcut to open context menu for debugging
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'm' && e.ctrlKey) {
        e.preventDefault();
        console.log('[ContextMenu] Opening test menu via keyboard');
        setContextMenuPosition({ x: 100, y: 100 });
        setContextMenuFile({ 
          name: 'test_file.py', 
          path: 'test/test_file.py', 
          type: 'file', 
          children: undefined 
        });
        setContextMenuOpened(true);
      }
    };
    
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);
  
  // Component templates
  const templates: Record<string, string> = {
    indicator: `"""
Indicator: ${fileName === 'new' ? 'YourIndicatorName' : fileName}
Category: momentum
Created: ${new Date().toISOString().split('T')[0]}
"""

from typing import Union
import numpy as np
import pandas as pd

class ${fileName === 'new' ? 'YourIndicatorName' : fileName.charAt(0).toUpperCase() + fileName.slice(1)}:
    """
    Description of what this indicator calculates
    """
    
    def __init__(self, period: int = 14):
        self.period = period
        
    def calculate(self, data: pd.Series) -> pd.Series:
        """
        Calculate the indicator values
        
        Args:
            data: Price series (typically 'close' prices)
            
        Returns:
            Pandas series with indicator values
        """
        # Your calculation here
        result = data.rolling(self.period).mean()
        return result

# Required metadata
metadata = {
    'name': '${fileName === 'new' ? 'your_indicator_name' : fileName}',
    'category': 'momentum',
    'inputs': ['close'],
    'outputs': ['value'],
    'parameters': {
        'period': {'type': 'int', 'default': 14, 'min': 2, 'max': 100}
    }
}`,
    signal: `"""
Signal: ${fileName === 'new' ? 'YourSignalName' : fileName}
Created: ${new Date().toISOString().split('T')[0]}
"""

from typing import Dict
import pandas as pd
from core.indicators.momentum import rsi
from core.indicators.trend import ema

class ${fileName === 'new' ? 'YourSignalName' : fileName.charAt(0).toUpperCase() + fileName.slice(1)}:
    """
    Signal description
    """
    
    required_indicators = ['rsi', 'ema20', 'ema50']
    
    def evaluate(self, data: pd.DataFrame, indicators: Dict[str, pd.Series]) -> pd.Series:
        """
        Evaluate signal conditions
        
        Args:
            data: OHLC DataFrame
            indicators: Dict of calculated indicator values
            
        Returns:
            Boolean series indicating signal triggers
        """
        # Signal logic
        buy_signal = (
            (indicators['rsi'] < 30) &
            (indicators['ema20'] > indicators['ema50']) &
            (data['close'] > indicators['ema20'])
        )
        return buy_signal`,
    order: `"""
Order Execution: ${fileName === 'new' ? 'YourOrderType' : fileName}
Created: ${new Date().toISOString().split('T')[0]}
"""

from typing import Dict, Optional
import numpy as np

class ${fileName === 'new' ? 'YourOrderType' : fileName.charAt(0).toUpperCase() + fileName.slice(1)}:
    """
    Order execution algorithm
    """
    
    def __init__(self, size: float, params: Optional[Dict] = None):
        self.size = size
        self.params = params or {}
        
    def execute(self, market_state: Dict) -> Dict:
        """
        Execute order based on market conditions
        
        Args:
            market_state: Current market data and conditions
            
        Returns:
            Order details to be sent to exchange
        """
        # Execution logic
        order = {
            'type': 'limit',
            'side': 'buy',
            'size': self.size,
            'price': market_state['bid'] + 0.0001,
            'time_in_force': 'IOC'
        }
        return order`,
    strategy: `name: "${fileName === 'new' ? 'YourStrategy' : fileName}"
author: "anon"
version: "1.0.0"
created: "${new Date().toISOString().split('T')[0]}"

# Import components
dependencies:
  indicators:
    - core.indicators.momentum.rsi
    - core.indicators.trend.ema
  signals:
    - core.signals.momentum_signals.MomentumBreakout
  orders:
    - core.orders.execution_algos.sniper

# Strategy parameters
parameters:
  position_size: 0.02  # 2% of capital
  max_positions: 3
  stop_loss: 0.02      # 2% stop
  take_profit: 0.05    # 5% target
  
# Risk management
risk:
  max_drawdown: 0.10   # 10% max drawdown
  daily_loss_limit: 0.03  # 3% daily loss limit
  
# Execution settings  
execution:
  order_type: "sniper"
  slippage_tolerance: 0.0005`
  };
  
  // Function to load workspace tree
  const loadWorkspace = async () => {
    try {
      const tree = await invoke<FileNode[]>('get_workspace_tree');
      setFileTree(tree);
    } catch (error) {
      console.error('Failed to load workspace:', error);
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: Failed to load workspace`]);
    }
  };

  // Function to load available categories
  const loadCategories = async () => {
    if (type === 'indicator') {
      try {
        const categories = await invoke<string[]>('get_indicator_categories');
        setAvailableCategories(categories);
        // Set default category if available
        if (categories.length > 0 && !categories.includes(newFileCategory)) {
          setNewFileCategory(categories[0]);
        }
      } catch (error) {
        console.error('Failed to load categories:', error);
        // Fallback to default categories
        setAvailableCategories(['momentum', 'trend', 'volatility', 'volume', 'microstructure']);
      }
    }
  };

  // Load workspace tree and categories on mount
  useEffect(() => {
    loadWorkspace();
    loadCategories();
    loadAvailableDatasets();
  }, []);
  
  // Handle resize drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (isResizingFileTree) {
        const newWidth = Math.max(150, Math.min(500, e.clientX));
        setFileTreeWidth(newWidth);
      }
      if (isResizingTerminal) {
        // Calculate height from bottom of window
        const windowHeight = window.innerHeight;
        const mouseY = e.clientY;
        const newHeight = Math.max(100, Math.min(windowHeight - 100, windowHeight - mouseY));
        setTerminalHeight(newHeight);
      }
    };
    
    const handleMouseUp = () => {
      setIsResizingFileTree(false);
      setIsResizingTerminal(false);
    };
    
    if (isResizingFileTree || isResizingTerminal) {
      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('mouseup', handleMouseUp, true);
      document.body.style.cursor = isResizingFileTree ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      
      // Prevent editor from capturing events
      const editorElements = document.querySelectorAll('.monaco-editor');
      editorElements.forEach(el => {
        (el as HTMLElement).style.pointerEvents = 'none';
      });
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove, true);
        document.removeEventListener('mouseup', handleMouseUp, true);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
        
        // Re-enable editor pointer events
        const editorElements = document.querySelectorAll('.monaco-editor');
        editorElements.forEach(el => {
          (el as HTMLElement).style.pointerEvents = 'auto';
        });
      };
    }
  }, [isResizingFileTree, isResizingTerminal]);

  // Auto-scroll terminal to bottom when new output is added
  useEffect(() => {
    if (terminalScrollRef.current) {
      const scrollArea = terminalScrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollArea) {
        scrollArea.scrollTop = scrollArea.scrollHeight;
      }
    }
  }, [terminalOutput]);

  // Optional: Periodic refresh of file tree (every 30 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      // Only refresh if the window is focused
      if (document.hasFocus()) {
        loadWorkspace();
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Load file content
  useEffect(() => {
    const loadFile = async () => {
      setIsLoading(true);
      
      if (fileName === 'new') {
        setCode(templates[type] || '# New file');
        setSelectedFile(`new_${type}.${type === 'strategy' ? 'yaml' : 'py'}`);
      } else if (filePath) {
        try {
          const content = await invoke<string>('read_component_file', { filePath });
          setCode(content);
          setSelectedFile(filePath);
          
          // Extract status from metadata if it's a Python file
          if (filePath.endsWith('.py')) {
            const statusMatch = content.match(/['"]status['"]\s*:\s*['"]([^'"]+)['"]/);
            if (statusMatch) {
              setComponentStatus(statusMatch[1]);
            } else {
              setComponentStatus('prototype');
            }
          }
        } catch (error) {
          console.error('Failed to load file:', error);
          setCode(`# Error loading file: ${error}`);
        }
      }
      
      setIsLoading(false);
    };
    
    loadFile();
  }, [type, fileName, filePath]);
  
  const toggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };
  
  const handleSave = async () => {
    if (!selectedFile || selectedFile.startsWith('new_')) {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: No file selected`]);
      return;
    }
    
    setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Saving ${selectedFile}...`]);
    
    try {
      await invoke('save_component_file', { 
        filePath: selectedFile, 
        content: code 
      });
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✓ File saved successfully`]);
    } catch (error) {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Error saving file: ${error}`]);
    }
  };
  
  const handleStatusChange = (newStatus: string | null) => {
    if (!newStatus || !selectedFile || !selectedFile.endsWith('.py')) return;
    
    setComponentStatus(newStatus);
    
    // Update the status in the code
    let updatedCode = code.replace(
      /(['"]status['"]\s*:\s*['"])[^'"]+(['"])/g,
      `$1${newStatus}$2`
    );
    
    // If status field doesn't exist, try to add it after 'author' or 'version'
    if (updatedCode === code && code.includes('__metadata__')) {
      const addAfterFields = ['author', 'version', 'description', 'category'];
      let added = false;
      
      for (const field of addAfterFields) {
        const pattern = new RegExp(`(['"]${field}['"]\s*:\s*['"][^'"]*['"])(,?)`);
        const match = updatedCode.match(pattern);
        if (match) {
          const replacement = `$1$2\n    'status': '${newStatus}',`;
          updatedCode = updatedCode.replace(pattern, replacement);
          if (updatedCode !== code) {
            added = true;
            break;
          }
        }
      }
      
      if (!added) {
        setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Warning: Could not update status in metadata`]);
      } else {
        setCode(updatedCode);
      }
    } else {
      setCode(updatedCode);
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: File name is required`]);
      return;
    }

    // Determine the file path based on component type and category
    let directory = '';
    let extension = '.py';
    
    if (type === 'indicator') {
      const categoryToUse = isCustomCategory ? customCategoryName : newFileCategory;
      directory = `core/indicators/${categoryToUse}`;
    } else if (type === 'signal') {
      directory = `core/signals`;
    } else if (type === 'order') {
      directory = `core/orders`;
    } else if (type === 'strategy') {
      directory = `strategies`;
      extension = '.yaml';
    }

    const fileName = newFileName.endsWith(extension) ? newFileName : newFileName + extension;
    const filePath = `${directory}/${fileName}`;

    try {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Creating ${filePath}...`]);
      
      await invoke('create_component_file', {
        filePath,
        componentType: type
      });
      
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✓ File created successfully`]);
      
      // Refresh file tree
      await loadWorkspace();
      
      // Expand the parent folder
      const parentPath = directory;
      setExpandedFolders(prev => new Set([...prev, 'core', parentPath]));
      
      // Select and load the new file
      setSelectedFile(filePath);
      const content = templates[type] || '# New file';
      setCode(content);
      
      // Close modal and reset
      setCreateFileOpened(false);
      setNewFileName('');
      setIsCustomCategory(false);
      setCustomCategoryName('');
      
      // Reload categories if we created a custom one
      if (isCustomCategory) {
        loadCategories();
      }
      
    } catch (error) {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Error creating file: ${error}`]);
    }
  };
  
  const handleRun = async () => {
    if (!selectedFile || selectedFile.startsWith('new_')) {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: No file selected`]);
      return;
    }
    
    if (!selectedFile.endsWith('.py')) {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Error: Can only run Python files`]);
      return;
    }
    
    // Clear terminal and set running state
    setTerminalOutput([]);
    setIsRunning(true);
    
    // Reset component output
    setComponentOutput({
      lastValue: '--',
      signal: '--', 
      execution: '--',
      dataPoints: '--'
    });
    
    try {
      // Set up event listeners
      const unlistenOutput = await listen<{
        type: 'stdout' | 'stderr' | 'error';
        line: string;
        timestamp: string;
      }>('component-output', (event) => {
        const { type, line, timestamp } = event.payload;
        const prefix = type === 'stderr' ? '❌ ' : type === 'error' ? '⚠️ ' : '';
        setTerminalOutput(prev => [...prev, `[${timestamp}] ${prefix}${line}`]);
        
        // Parse output for useful information
        if (type === 'stdout') {
          // Parse execution time
          if (line.includes('Execution completed in')) {
            const match = line.match(/(\d+\.?\d*)\s*ms/);
            if (match) {
              setComponentOutput(prev => ({ ...prev, execution: `${match[1]}ms` }));
            }
          }
          
          // Parse data shape
          if (line.includes('Shape:')) {
            const match = line.match(/\((\d+),/);
            if (match) {
              setComponentOutput(prev => ({ ...prev, dataPoints: match[1] }));
            }
          }
          
          // Parse indicator data output (JSON format)
          if (line.startsWith('INDICATOR_DATA:')) {
            try {
              const jsonStr = line.substring('INDICATOR_DATA:'.length);
              const indicatorData = JSON.parse(jsonStr);
              
              // Update chart with indicator overlay
              if (chartData && indicatorData.values && indicatorData.name) {
                setChartData(prev => ({
                  ...prev!,
                  indicators: {
                    ...prev?.indicators,
                    [indicatorData.name]: indicatorData.values
                  }
                }));
              }
              
              // Update last value
              if (indicatorData.values && indicatorData.values.length > 0) {
                const lastValue = indicatorData.values[indicatorData.values.length - 1];
                setComponentOutput(prev => ({ 
                  ...prev, 
                  lastValue: typeof lastValue === 'number' ? lastValue.toFixed(4) : lastValue 
                }));
              }
            } catch (e) {
              console.error('Failed to parse indicator data:', e);
            }
          }
          
          // Parse statistics
          if (line.includes('Mean SMA:') || line.includes('Mean:')) {
            const match = line.match(/:\s*(\d+\.\d+)/);
            if (match) {
              setComponentOutput(prev => ({ ...prev, lastValue: match[1] }));
            }
          }
          
          // Parse signal output
          if (line.includes('Signal:') || line.includes('SIGNAL:')) {
            if (line.toLowerCase().includes('buy')) {
              setComponentOutput(prev => ({ ...prev, signal: 'BUY' }));
            } else if (line.toLowerCase().includes('sell')) {
              setComponentOutput(prev => ({ ...prev, signal: 'SELL' }));
            } else if (line.toLowerCase().includes('neutral')) {
              setComponentOutput(prev => ({ ...prev, signal: 'NEUTRAL' }));
            }
          }
        }
      });
      
      const unlistenStart = await listen<{
        file: string;
        timestamp: string;
      }>('component-run-start', (event) => {
        setTerminalOutput(prev => [...prev, `[${event.payload.timestamp}] 🚀 Starting execution of ${event.payload.file}...`]);
      });
      
      const unlistenComplete = await listen<{
        file: string;
        success: boolean;
        execution_time_ms: number;
        timestamp: string;
      }>('component-run-complete', (event) => {
        const { success, execution_time_ms, timestamp } = event.payload;
        setTerminalOutput(prev => [...prev, 
          `[${timestamp}] ${success ? '✅' : '❌'} Execution ${success ? 'completed' : 'failed'} in ${execution_time_ms.toFixed(2)}ms`
        ]);
        setIsRunning(false);
      });
      
      // Run the component
      const result = await invoke<{
        success: boolean;
        execution_time_ms: number;
        output_lines: number;
        error_lines: number;
      }>('run_component', { 
        filePath: selectedFile,
        dataset: selectedDataset 
      });
      
      // Clean up listeners
      await unlistenOutput();
      await unlistenStart();
      await unlistenComplete();
      
      // Add summary if no output
      if (result.output_lines === 0 && result.error_lines === 0) {
        setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ℹ️ No output produced`]);
      }
      
    } catch (error) {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Error: ${error}`]);
      setIsRunning(false);
    }
  };
  
  const handleDelete = async () => {
    if (!fileToDelete) {
      console.error('[Delete] No file to delete');
      return;
    }
    
    console.log('[Delete] Executing delete for:', fileToDelete.name, fileToDelete.path);
    
    const isFolder = fileToDelete.type === 'folder';
    
    setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🔄 Deleting ${fileToDelete.name}...`]);
    
    try {
      if (isFolder) {
        console.log('[Delete] Invoking delete_component_folder for:', fileToDelete.path);
        await invoke('delete_component_folder', { folderPath: fileToDelete.path });
      } else {
        console.log('[Delete] Invoking delete_component_file for:', fileToDelete.path);
        await invoke('delete_component_file', { filePath: fileToDelete.path });
        
        // If deleting currently open file, clear the editor
        if (selectedFile === fileToDelete.path) {
          setCode('# Select a file to edit');
          setSelectedFile('');
          setComponentStatus('prototype');
        }
      }
      
      console.log('[Delete] Delete successful');
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✓ Deleted ${fileToDelete.name}`]);
      
      // Refresh file tree
      await loadWorkspace();
      
      // Close the modal
      setDeleteModalOpened(false);
      setFileToDelete(null);
    } catch (error) {
      console.error('[Delete] Error:', error);
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Error deleting: ${error}`]);
    }
  };
  
  const handleRename = async () => {
    if (!contextMenuFile || !renameFileName.trim()) return;
    
    const isFolder = contextMenuFile.type === 'folder';
    
    // Validate name based on type
    if (isFolder) {
      if (!renameFileName.match(/^[a-zA-Z0-9_\-]+$/)) {
        setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Error: Invalid folder name. Use only letters, numbers, underscore, and dash.`]);
        return;
      }
    } else {
      if (!renameFileName.match(/^[a-zA-Z0-9_\-]+\.(py|yaml|yml)$/)) {
        setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Error: Invalid file name. Use only letters, numbers, underscore, and dash.`]);
        return;
      }
    }
    
    try {
      let newPath: string;
      
      if (isFolder) {
        newPath = await invoke<string>('rename_component_folder', { 
          oldPath: contextMenuFile.path, 
          newName: renameFileName 
        });
      } else {
        newPath = await invoke<string>('rename_component_file', { 
          oldPath: contextMenuFile.path, 
          newName: renameFileName 
        });
        
        // Update selected file if it was renamed
        if (selectedFile === contextMenuFile.path) {
          setSelectedFile(newPath);
        }
      }
      
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✓ Renamed to ${renameFileName}`]);
      
      // Refresh file tree
      await loadWorkspace();
      
      // Close modal
      setRenameModalOpened(false);
      setRenameFileName('');
    } catch (error) {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Error renaming: ${error}`]);
    }
  };
  
  const handleExportData = async () => {
    if (!exportStartDate || !exportEndDate) {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Error: Please select start and end dates`]);
      return;
    }
    
    setIsExporting(true);
    
    try {
      // Ensure dates are Date objects
      const startDate = exportStartDate instanceof Date ? exportStartDate : new Date(exportStartDate);
      const endDate = exportEndDate instanceof Date ? exportEndDate : new Date(exportEndDate);
      
      // Format dates as YYYY-MM-DD
      const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      const startDateStr = formatDate(startDate);
      const endDateStr = formatDate(endDate);
      
      // Generate filename if not provided
      const filename = exportFilename.trim() || 
        `${exportSymbol.toLowerCase()}_${exportTimeframe}_${startDateStr}_${endDateStr}.csv`;
      
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🚀 Exporting ${exportSymbol} ${exportTimeframe} data...`]);
      
      const result = await invoke<string>('export_test_data', {
        request: {
          symbol: exportSymbol,
          timeframe: exportTimeframe,
          start_date: startDateStr,
          end_date: endDateStr,
          filename: filename
        }
      });
      
      const parquetFilename = filename.replace('.csv', '.parquet');
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✓ Data exported to: ${parquetFilename}`]);
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🎉 Ready to use! Run your component to load this data.`]);
      
      // Refresh available datasets
      await loadAvailableDatasets();
      
      // Close modal
      setExportModalOpened(false);
      setExportFilename('');
      
    } catch (error) {
      setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Export failed: ${error}`]);
    } finally {
      setIsExporting(false);
    }
  };
  
  const loadAvailableDatasets = async () => {
    try {
      // Get available parquet datasets
      const datasets = await invoke<string[]>('list_test_datasets');
      setAvailableDatasets(datasets);
      
      // If we just exported data, select the newest one
      if (datasets.length > 0 && !selectedDataset) {
        setSelectedDataset(datasets[0]);
      }
    } catch (error) {
      console.error('Failed to load datasets:', error);
    }
  };
  
  const renderFileTree = (nodes: FileNode[], depth: number = 0) => {
    // Filter based on component type
    const allowedPaths: Record<string, string[]> = {
      indicator: ['core/indicators'],
      signal: ['core/indicators', 'core/signals'],
      order: ['core/orders', 'core/signals'],
      strategy: ['core', 'strategies']
    };
    
    return nodes.map(node => {
      const isExpanded = expandedFolders.has(node.path);
      const indent = depth * 16;
      
      // Check if this path should be visible for current component type
      const isAllowed = allowedPaths[type].some(allowed => 
        node.path.startsWith(allowed) || allowed.startsWith(node.path)
      );
      
      if (!isAllowed) return null;
      
      if (node.type === 'folder') {
        // Check if this is a custom category folder (under indicators and not a default category)
        const isCustomCategory = node.path.startsWith('core/indicators/') && 
          depth === 2 && // Direct child of indicators folder
          !['momentum', 'trend', 'volatility', 'volume', 'microstructure'].includes(node.name);
        
        return (
          <div key={node.path}>
            <UnstyledButton
              onClick={() => toggleFolder(node.path)}
              onContextMenu={isCustomCategory ? (e) => {
                e.preventDefault();
                console.log('[ContextMenu] Opening for folder:', node.name, node.path);
                setContextMenuPosition({ x: e.clientX, y: e.clientY });
                setContextMenuFile(node);
                setContextMenuOpened(true);
              } : undefined}
              style={{
                width: '100%',
                padding: '4px 8px',
                paddingLeft: `${indent + 8}px`,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: '#aaa',
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.05)'
                }
              }}
            >
              {isExpanded ? <IconFolderOpen size={16} /> : <IconFolder size={16} />}
              <Text size="sm">{node.name}</Text>
            </UnstyledButton>
            {isExpanded && node.children && (
              <div>{renderFileTree(node.children, depth + 1)}</div>
            )}
          </div>
        );
      } else {
        const icon = node.name.endsWith('.py') ? <IconFileCode size={16} /> : <IconJson size={16} />;
        return (
          <UnstyledButton
            key={node.path}
            onClick={async () => {
              setSelectedFile(node.path);
              setIsLoading(true);
              
              // Load file content
              try {
                const content = await invoke<string>('read_component_file', { filePath: node.path });
                setCode(content);
                setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Loaded ${node.path}`]);
                
                // Extract status from metadata if it's a Python file
                if (node.path.endsWith('.py')) {
                  const statusMatch = content.match(/['"]status['"]\s*:\s*['"]([^'"]+)['"]/);
                  if (statusMatch) {
                    setComponentStatus(statusMatch[1]);
                  } else {
                    setComponentStatus('prototype');
                  }
                }
              } catch (error) {
                setCode(`# Error loading file: ${error}`);
                setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Error loading ${node.path}: ${error}`]);
              } finally {
                setIsLoading(false);
              }
              
              // Update context when file is selected
              const componentInfo = {
                type,
                name: node.name.replace(/\.(py|yaml|json)$/, ''),
                path: node.path
              };
              setLastOpenedComponent(componentInfo);
              addToRecentComponents(componentInfo);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              console.log('[ContextMenu] Opening for file:', node.name, node.path);
              setContextMenuPosition({ x: e.clientX, y: e.clientY });
              setContextMenuFile(node);
              setContextMenuOpened(true);
            }}
            style={{
              width: '100%',
              padding: '4px 8px',
              paddingLeft: `${indent + 8}px`,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: selectedFile === node.path ? '#4a9eff' : '#888',
              backgroundColor: selectedFile === node.path ? 'rgba(74, 158, 255, 0.1)' : 'transparent',
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.05)'
              }
            }}
          >
            {icon}
            <Text size="sm">{node.name}</Text>
          </UnstyledButton>
        );
      }
    });
  };
  
  return (
    <Box style={{ height: '100vh', width: '100vw', display: 'flex', background: '#1e1e1e', overflow: 'hidden', position: 'relative' }}>
      {/* Overlay during resize to prevent editor interference */}
      {(isResizingFileTree || isResizingTerminal) && (
        <Box
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            cursor: isResizingFileTree ? 'col-resize' : 'row-resize'
          }}
        />
      )}
      
      {/* File Explorer */}
      <Box style={{ 
        width: `${fileTreeWidth}px`, 
        background: '#252526', 
        borderRight: '1px solid #3e3e42',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}>
        <Box style={{ 
          padding: '12px', 
          borderBottom: '1px solid #3e3e42',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <Text size="sm" fw={500} c="#cccccc">WORKSPACE</Text>
          <Group gap={4}>
            <ActionIcon 
              size="sm" 
              variant="subtle" 
              c="gray"
              onClick={loadWorkspace}
              title="Refresh file tree"
            >
              <IconRefresh size={14} />
            </ActionIcon>
            <ActionIcon 
              size="sm" 
              variant="subtle" 
              c="gray"
              onClick={() => setCreateFileOpened(true)}
              title={`Create new ${type}`}
            >
              <IconPlus size={14} />
            </ActionIcon>
          </Group>
        </Box>
        <ScrollArea style={{ flex: 1 }}>
          <Box p="xs">
            {renderFileTree(fileTree)}
          </Box>
        </ScrollArea>
        
        {/* File tree resize handle */}
        <Box
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsResizingFileTree(true);
          }}
          onMouseEnter={(e) => {
            if (!isResizingFileTree) {
              e.currentTarget.style.background = 'rgba(74, 158, 255, 0.5)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isResizingFileTree) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
          style={{
            position: 'absolute',
            top: 0,
            right: -3,
            width: '6px',
            height: '100%',
            cursor: 'col-resize',
            background: isResizingFileTree ? '#4a9eff' : 'transparent',
            transition: 'background 0.2s',
            zIndex: 10
          }}
        />
      </Box>
      
      {/* Editor Area */}
      <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        {/* Editor Header */}
        <Box style={{
          height: '40px',
          background: '#2d2d30',
          borderBottom: '1px solid #3e3e42',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px'
        }}>
          <Group gap="sm">
            <ActionIcon 
              onClick={() => navigate('/build')}
              variant="subtle"
              c="gray"
              size="sm"
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
            <Group gap="xs">
              <IconFile size={16} style={{ color: '#888' }} />
              <Text size="sm" c="#cccccc">{selectedFile || 'untitled.py'}</Text>
              <Text size="xs" c="#888">• Python</Text>
            </Group>
          </Group>
          
          <Group gap="xs">
            {selectedFile && selectedFile.endsWith('.py') && !selectedFile.startsWith('new_') && (
              <Select
                value={componentStatus}
                onChange={handleStatusChange}
                data={[
                  { value: 'prototype', label: 'Prototype' },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'ready', label: 'Ready' }
                ]}
                size="xs"
                styles={{
                  input: {
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    fontSize: '12px',
                    color: 'white',
                    height: '28px',
                    minWidth: '120px'
                  },
                  dropdown: {
                    background: '#1a1a1a',
                    border: '1px solid #444',
                  },
                }}
              />
            )}
            <ActionIcon 
              onClick={() => setHelpOpened(true)}
              variant="subtle"
              c="gray"
              size="sm"
              title="Architecture Help"
            >
              <IconQuestionMark size={16} />
            </ActionIcon>
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={14} />}
              variant="subtle"
              onClick={handleSave}
            >
              Save
            </Button>
            <Button
              size="xs"
              leftSection={<IconPlayerPlay size={14} />}
              variant="subtle"
              color="green"
              onClick={handleRun}
              loading={isRunning}
              disabled={!selectedFile || !selectedFile.endsWith('.py')}
            >
              {isRunning ? 'Running...' : 'Run'}
            </Button>
          </Group>
        </Box>
        
        {/* Monaco Editor */}
        <Box style={{ height: `calc(100vh - 40px - ${terminalHeight}px)`, overflow: 'hidden' }}>
          {isLoading ? (
            <Box style={{ 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center' 
            }}>
              <Loader />
            </Box>
          ) : (
            <Editor
              value={code}
              onChange={(value) => setCode(value || '')}
              language={selectedFile?.endsWith('.yaml') ? 'yaml' : 'python'}
              theme="vs-dark"
              options={{
                minimap: { enabled: true },
                fontSize: 14,
                fontFamily: 'Fira Code, monospace',
                automaticLayout: true,
                formatOnPaste: true,
                formatOnType: true,
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                lineNumbers: 'on',
                renderWhitespace: 'selection',
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: 'on',
                tabSize: 4,
                insertSpaces: true,
              }}
              onMount={(editor) => {
                // Add keyboard shortcut for run
                editor.addAction({
                  id: 'run-code',
                  label: 'Run Code',
                  keybindings: [
                    // Cmd+Enter on Mac, Ctrl+Enter on Windows/Linux
                    2048 /* CtrlCmd */ + 3 /* Enter */
                  ],
                  run: () => {
                    if (selectedFile?.endsWith('.py') && !isRunning) {
                      handleRun();
                    }
                  }
                });
              }}
            />
          )}
        </Box>
        
        {/* Terminal */}
        <Box style={{ 
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: `${terminalHeight}px`, 
          background: '#1e1e1e', 
          borderTop: '1px solid #3e3e42',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 5
        }}>
          {/* Terminal resize handle */}
          <Box
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsResizingTerminal(true);
            }}
            onMouseEnter={(e) => {
              if (!isResizingTerminal) {
                e.currentTarget.style.background = 'rgba(74, 158, 255, 0.5)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isResizingTerminal) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
            style={{
              position: 'absolute',
              top: -3,
              left: 0,
              right: 0,
              height: '6px',
              cursor: 'row-resize',
              background: isResizingTerminal ? '#4a9eff' : 'transparent',
              transition: 'background 0.2s',
              zIndex: 10
            }}
          />
          <Box style={{ 
            padding: '8px 16px', 
            borderBottom: '1px solid #3e3e42',
            background: '#2d2d30',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <Group gap="xs">
              <Text size="xs" fw={500} c="#cccccc">TERMINAL</Text>
              {selectedFile?.endsWith('.py') && (
                <Text size="xs" c="dimmed" ff="monospace">
                  {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to run
                </Text>
              )}
            </Group>
            <ActionIcon 
              size="xs" 
              variant="subtle" 
              c="gray"
              onClick={() => setTerminalOutput([])}
              title="Clear terminal"
            >
              <IconX size={14} />
            </ActionIcon>
          </Box>
          <ScrollArea style={{ flex: 1, padding: '8px 16px' }} ref={terminalScrollRef}>
            <Stack gap={4}>
              {terminalOutput.map((line, index) => {
                // Determine color based on content
                let color = '#888'; // default gray
                if (line.includes('✓')) {
                  color = '#4ec9b0'; // green for success
                } else if (line.includes('❌') || line.includes('Error:') || line.includes('Failed')) {
                  color = '#f48771'; // red for errors
                } else if (line.includes('⚠️') || line.includes('Warning')) {
                  color = '#dcdcaa'; // yellow for warnings
                } else if (line.includes('Starting') || line.includes('Creating') || line.includes('Loading')) {
                  color = '#569cd6'; // blue for info
                }
                
                return (
                  <Text key={index} size="xs" ff="monospace" c={color}>
                    {line}
                  </Text>
                );
              })}
            </Stack>
          </ScrollArea>
        </Box>
      </Box>
      
      {/* Live Preview */}
      <Box style={{ 
        width: '400px', 
        background: '#252526', 
        borderLeft: '1px solid #3e3e42',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <Box style={{ 
          padding: '12px', 
          borderBottom: '1px solid #3e3e42',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <Text size="sm" fw={500} c="#cccccc">LIVE PREVIEW</Text>
          <ActionIcon 
            size="sm" 
            variant="subtle" 
            c="gray"
            onClick={() => setExportModalOpened(true)}
            title="Export test data"
          >
            <IconDatabase size={14} />
          </ActionIcon>
        </Box>
        
        <Box style={{ flex: 1, padding: '16px' }}>
          {/* Dataset selector with refresh */}
          <Group gap="xs" mb="xs">
            <Select
            size="xs"
            placeholder="Select test dataset"
            value={selectedDataset}
            disabled={availableDatasets.length === 0}
            onChange={async (value) => {
              // Don't reload if selecting the same dataset
              if (value === selectedDataset) {
                return;
              }
              
              setSelectedDataset(value);
              if (value) {
                setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Selected dataset: ${value}`]);
                
                // Load the chart data
                try {
                  setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Loading chart data...`]);
                  const data = await invoke<{
                    time: string[];
                    open: number[];
                    high: number[];
                    low: number[];
                    close: number[];
                  }>('load_parquet_data', { datasetName: value });
                  
                  setChartData(data);
                  setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✓ Chart data loaded (${data.time.length} candles)`]);
                } catch (error) {
                  setTerminalOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ Failed to load chart data: ${error}`]);
                  setChartData(null);
                }
              } else {
                setChartData(null);
              }
            }}
            data={availableDatasets.map(ds => ({ 
              value: ds, 
              label: ds,
              disabled: ds === selectedDataset
            }))}
            style={{ flex: 1 }}
            popoverProps={{
              withinPortal: true,
              zIndex: 9999
            }}
            styles={{
              input: {
                background: '#2a2a2a',
                border: '1px solid #444',
                marginBottom: '12px',
                color: '#fff',
                '&:hover': {
                  borderColor: '#666'
                },
                '&:focus': {
                  borderColor: '#4a9eff'
                }
              },
              dropdown: {
                background: '#1a1a1a',
                border: '1px solid #444',
                zIndex: 9999
              },
              item: {
                color: '#ccc',
                '&[data-hovered]': {
                  backgroundColor: '#2a2a2a',
                  color: '#fff'
                },
                '&[data-selected]': {
                  backgroundColor: '#4a9eff',
                  color: '#fff'
                },
                '&[data-disabled]': {
                  opacity: 0.5,
                  cursor: 'not-allowed',
                  color: '#666'
                }
              }
            }}
          />
          <ActionIcon 
            size="sm" 
            variant="subtle" 
            onClick={() => loadAvailableDatasets()}
            title="Refresh datasets"
          >
            <IconRefresh size={14} />
          </ActionIcon>
        </Group>
          
          {/* Chart preview */}
          <PreviewChart 
            data={chartData} 
            height={200} 
            isFullscreen={previewFullscreen}
            onToggleFullscreen={() => setPreviewFullscreen(!previewFullscreen)}
          />
          
          {/* Component output values */}
          <Stack gap="xs" mt="md">
            <Text size="xs" fw={500} c="#888" mb={4}>COMPONENT OUTPUT</Text>
            <Group justify="space-between">
              <Text size="sm" c="#888">Last Value:</Text>
              <Text size="sm" c="#cccccc" ff="monospace">{componentOutput.lastValue}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="#888">Signal:</Text>
              <Text size="sm" c={componentOutput.signal === 'BUY' ? '#4ec9b0' : componentOutput.signal === 'SELL' ? '#f48771' : '#666'} ff="monospace">
                {componentOutput.signal}
              </Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="#888">Execution:</Text>
              <Text size="sm" c="#666" ff="monospace">{componentOutput.execution}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="#888">Data Points:</Text>
              <Text size="sm" c="#666" ff="monospace">{componentOutput.dataPoints}</Text>
            </Group>
          </Stack>
          
          {/* Help text */}
          <Text size="xs" c="#555" mt="xl">
            Export test data using the database icon above, then select a dataset to preview your component's behavior.
          </Text>
        </Box>
      </Box>
      
      {/* Help Modal */}
      <IDEHelpModal 
        opened={helpOpened}
        onClose={() => setHelpOpened(false)}
        currentType={type as 'indicator' | 'signal' | 'order' | 'strategy'}
      />

      {/* Create File Modal */}
      <Modal
        opened={createFileOpened}
        onClose={() => {
          setCreateFileOpened(false);
          setNewFileName('');
          setIsCustomCategory(false);
          setCustomCategoryName('');
        }}
        title={`Create New ${type.charAt(0).toUpperCase() + type.slice(1)}`}
        size="sm"
      >
        <Stack gap="md">
          <TextInput
            label="File Name"
            placeholder={type === 'strategy' ? 'my_strategy' : 'my_' + type}
            value={newFileName}
            onChange={(e) => setNewFileName(e.currentTarget.value)}
            description={`Will be saved as ${newFileName || 'filename'}${type === 'strategy' ? '.yaml' : '.py'}`}
            required
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleCreateFile();
              }
            }}
          />
          
          {type === 'indicator' && (
            <>
              <Select
                label="Category"
                value={isCustomCategory ? 'custom' : newFileCategory}
                onChange={(value) => {
                  if (value === 'custom') {
                    setIsCustomCategory(true);
                  } else {
                    setIsCustomCategory(false);
                    setNewFileCategory(value || availableCategories[0] || 'momentum');
                  }
                }}
                data={[
                  ...availableCategories.map(cat => ({ 
                    value: cat, 
                    label: cat.charAt(0).toUpperCase() + cat.slice(1) 
                  })),
                  { value: 'custom', label: '+ Create New Category...' }
                ]}
                required
              />
              
              {isCustomCategory && (
                <TextInput
                  label="New Category Name"
                  placeholder="e.g., orderflow, market_profile"
                  value={customCategoryName}
                  onChange={(e) => setCustomCategoryName(e.currentTarget.value.toLowerCase().replace(/\s+/g, '_'))}
                  description="Category folder will be created automatically"
                  required
                />
              )}
            </>
          )}
          
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={() => {
              setCreateFileOpened(false);
              setNewFileName('');
              setIsCustomCategory(false);
              setCustomCategoryName('');
            }}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateFile}
              disabled={!newFileName.trim() || (isCustomCategory && !customCategoryName.trim())}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
      
      {/* Context Menu - Custom Implementation */}
      {contextMenuOpened && contextMenuFile && (
        <>
          {/* Backdrop to close menu when clicking outside */}
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 9998,
              background: 'transparent'
            }}
            onClick={() => {
              console.log('[ContextMenu] Backdrop clicked, closing menu');
              setContextMenuOpened(false);
              setContextMenuFile(null);
            }}
          />
          
          {/* Context Menu */}
          <Box
            style={{
              position: 'fixed',
              left: Math.min(contextMenuPosition.x, window.innerWidth - 160), // Prevent menu from going off-screen
              top: Math.min(contextMenuPosition.y, window.innerHeight - 100),
              background: '#2a2a2a',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '4px',
              minWidth: '150px',
              zIndex: 9999,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)'
            }}
          >
            <UnstyledButton
              component="button"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                console.log('[ContextMenu] Rename clicked');
                const file = contextMenuFile;
                setContextMenuOpened(false);
                if (file) {
                  setRenameFileName(file.name);
                  setRenameModalOpened(true);
                }
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                width: '100%',
                borderRadius: '4px',
                color: '#ccc',
                backgroundColor: 'transparent',
                transition: 'background-color 0.2s',
                cursor: 'pointer'
              }}
            >
              <IconEdit size={14} />
              <Text size="sm">Rename</Text>
            </UnstyledButton>
            
            <UnstyledButton
              component="button"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                console.log('[ContextMenu] Delete clicked, file:', contextMenuFile);
                const file = contextMenuFile;
                setContextMenuOpened(false);
                if (file) {
                  setFileToDelete(file);
                  setDeleteModalOpened(true);
                } else {
                  console.error('[ContextMenu] No file selected for deletion');
                }
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                width: '100%',
                borderRadius: '4px',
                color: '#ff6b6b',
                backgroundColor: 'transparent',
                transition: 'background-color 0.2s',
                cursor: 'pointer'
              }}
            >
              <IconTrash size={14} />
              <Text size="sm">Delete</Text>
            </UnstyledButton>
          </Box>
        </>
      )}
      
      {/* Rename Modal */}
      <Modal
        opened={renameModalOpened}
        onClose={() => {
          setRenameModalOpened(false);
          setRenameFileName('');
        }}
        title={`Rename ${contextMenuFile?.type === 'folder' ? 'Folder' : 'File'}`}
        size="sm"
      >
        <Stack gap="md">
          <TextInput
            label="New Name"
            value={renameFileName}
            onChange={(e) => setRenameFileName(e.currentTarget.value)}
            placeholder={contextMenuFile?.name || ''}
            description={contextMenuFile?.type === 'folder' ? 
              "Folder name (no extension)" : 
              "Include the file extension (.py or .yaml)"}
            required
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleRename();
              }
            }}
          />
          
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={() => {
              setRenameModalOpened(false);
              setRenameFileName('');
            }}>
              Cancel
            </Button>
            <Button 
              onClick={handleRename}
              disabled={!renameFileName.trim()}
            >
              Rename
            </Button>
          </Group>
        </Stack>
      </Modal>
      
      {/* Export Data Modal */}
      <Modal
        opened={exportModalOpened}
        onClose={() => {
          setExportModalOpened(false);
          setExportFilename('');
        }}
        title="Export Test Data"
        size="md"
      >
        <Stack gap="md">
          <Select
            label="Symbol"
            value={exportSymbol}
            onChange={(value) => setExportSymbol(value || 'EURUSD')}
            data={[
              { value: 'EURUSD', label: 'EUR/USD' },
              { value: 'USDJPY', label: 'USD/JPY' },
              { value: 'GBPUSD', label: 'GBP/USD' },
              { value: 'AUDUSD', label: 'AUD/USD' }
            ]}
            required
          />
          
          <Select
            label="Timeframe"
            value={exportTimeframe}
            onChange={(value) => setExportTimeframe(value || '1h')}
            data={[
              { value: '5m', label: '5 minutes' },
              { value: '15m', label: '15 minutes' },
              { value: '1h', label: '1 hour' },
              { value: '4h', label: '4 hours' },
              { value: '12h', label: '12 hours' }
            ]}
            required
          />
          
          <DatePickerInput
            label="Start Date"
            placeholder="Select start date"
            value={exportStartDate}
            onChange={setExportStartDate}
            required
          />
          
          <DatePickerInput
            label="End Date"
            placeholder="Select end date"
            value={exportEndDate}
            onChange={setExportEndDate}
            required
          />
          
          <TextInput
            label="Filename (optional)"
            placeholder="Leave empty for auto-generated name"
            value={exportFilename}
            onChange={(e) => setExportFilename(e.currentTarget.value)}
            description="Will be saved in workspace/data/"
          />
          
          <Group justify="space-between" mt="md">
            <Text size="xs" c="dimmed">
              Data will be exported as CSV and can be converted to Parquet
            </Text>
            <Group>
              <Button variant="subtle" onClick={() => {
                setExportModalOpened(false);
                setExportFilename('');
              }}>
                Cancel
              </Button>
              <Button 
                onClick={handleExportData}
                loading={isExporting}
                leftSection={<IconDownload size={14} />}
              >
                Export
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
      
      {/* Delete Confirmation Modal */}
      <Modal
        opened={deleteModalOpened}
        onClose={() => {
          setDeleteModalOpened(false);
          setFileToDelete(null);
        }}
        title="Confirm Delete"
        size="sm"
      >
        <Stack gap="md">
          <Text>
            Are you sure you want to delete {fileToDelete?.type === 'folder' ? 'folder' : 'file'} <strong>{fileToDelete?.name}</strong>?
          </Text>
          {fileToDelete?.type === 'folder' && (
            <Text size="sm" c="yellow">
              Warning: This will delete all files inside this folder.
            </Text>
          )}
          
          <Group justify="flex-end" mt="md">
            <Button 
              variant="subtle" 
              onClick={() => {
                setDeleteModalOpened(false);
                setFileToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button 
              color="red"
              onClick={handleDelete}
              leftSection={<IconTrash size={14} />}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
};