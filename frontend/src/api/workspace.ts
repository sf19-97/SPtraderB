// Workspace API client for HTTP communication with the API server

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

console.log('[API] Using API base URL:', API_BASE);

// ============================================================================
// Types (matching backend)
// ============================================================================

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

export interface ComponentInfo {
  name: string;
  component_type: string;
  category: string;
  path: string;
  has_metadata: boolean;
  status: string;
}

export interface RunComponentResponse {
  success: boolean;
  execution_time_ms: number;
  stdout: string[];
  stderr: string[];
  output_lines: number;
  error_lines: number;
}

// ============================================================================
// Helper: Fetch with error handling
// ============================================================================

async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  console.log('[API] Fetching:', url, 'Method:', options?.method || 'GET');

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  console.log('[API] Response:', response.status, response.statusText);

  if (!response.ok) {
    const error = await response.text();
    console.error('[API] Error response:', error);
    throw new Error(error || `HTTP ${response.status}`);
  }

  // Handle empty responses (204, DELETE)
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return response.json();
}

// ============================================================================
// API Functions (direct mapping to endpoints)
// ============================================================================

export const workspaceApi = {
  // GET /api/workspace/tree
  getTree: async (): Promise<FileNode[]> => {
    return apiFetch<FileNode[]>('/api/workspace/tree');
  },

  // GET /api/workspace/files/{path}
  readFile: async (path: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/api/workspace/files/${path}`);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.text(); // Plain text, not JSON
  },

  // PUT /api/workspace/files/{path}
  saveFile: async (path: string, content: string): Promise<void> => {
    return apiFetch<void>(`/api/workspace/files/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  },

  // POST /api/workspace/files
  createFile: async (path: string, componentType: string): Promise<void> => {
    return apiFetch<void>('/api/workspace/files', {
      method: 'POST',
      body: JSON.stringify({ path, component_type: componentType }),
    });
  },

  // DELETE /api/workspace/files/{path}
  deleteFile: async (path: string): Promise<void> => {
    return apiFetch<void>(`/api/workspace/files/${path}`, {
      method: 'DELETE',
    });
  },

  // POST /api/workspace/rename
  renameFile: async (oldPath: string, newName: string): Promise<string> => {
    return apiFetch<string>(`/api/workspace/rename`, {
      method: 'POST',
      body: JSON.stringify({ old_path: oldPath, new_name: newName }),
    });
  },

  // GET /api/workspace/components
  getComponents: async (): Promise<ComponentInfo[]> => {
    return apiFetch<ComponentInfo[]>('/api/workspace/components');
  },

  // GET /api/workspace/categories/{type}
  getCategories: async (componentType: string): Promise<string[]> => {
    return apiFetch<string[]>(`/api/workspace/categories/${componentType}`);
  },

  // POST /api/workspace/run-component
  runComponent: async (
    filePath: string,
    dataset: string | null,
    envVars: Record<string, string>,
    candleData?: any
  ): Promise<RunComponentResponse> => {
    return apiFetch<RunComponentResponse>('/api/workspace/run-component', {
      method: 'POST',
      body: JSON.stringify({
        file_path: filePath,
        dataset,
        env_vars: envVars,
        candle_data: candleData,
      }),
    });
  },
};

// ============================================================================
// Orchestrator / Backtest API
// ============================================================================

export interface BacktestRequest {
  strategy_name: string;
  start_date: string; // ISO 8601 format
  end_date: string; // ISO 8601 format
  symbol: string;
  timeframe: string;
  initial_capital: number;
}

export interface BacktestResponse {
  backtest_id: string;
  status: string;
}

export interface BacktestStatus {
  backtest_id: string;
  status: string;
  progress?: number;
}

export interface BacktestResults {
  backtest_id: string;
  start_capital: number;
  end_capital: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_pnl: number;
  max_drawdown: number;
  sharpe_ratio: number;
  signals_generated: number;
  daily_returns?: any;
  completed_trades: Trade[];
}

export interface Trade {
  id: string;
  symbol: string;
  side: string;
  entry_time: string;
  entry_price: number;
  exit_time: string;
  exit_price: number;
  quantity: number;
  pnl: number;
  pnl_percent: number;
  exit_reason: string;
  holding_period_hours: number;
}

export const orchestratorApi = {
  // POST /api/backtest/run
  runBacktest: async (request: BacktestRequest): Promise<BacktestResponse> => {
    return apiFetch<BacktestResponse>('/api/backtest/run', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  // GET /api/backtest/{id}/status
  getBacktestStatus: async (backtestId: string): Promise<BacktestStatus> => {
    return apiFetch<BacktestStatus>(`/api/backtest/${backtestId}/status`);
  },

  // GET /api/backtest/{id}/results
  getBacktestResults: async (backtestId: string): Promise<BacktestResults> => {
    return apiFetch<BacktestResults>(`/api/backtest/${backtestId}/results`);
  },

  // POST /api/backtest/{id}/cancel
  cancelBacktest: async (backtestId: string): Promise<void> => {
    return apiFetch<void>(`/api/backtest/${backtestId}/cancel`, {
      method: 'POST',
    });
  },
};
