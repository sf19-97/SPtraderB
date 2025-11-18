import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

// Types
export interface StrategyInfo {
  name: string;
  path: string;
  description?: string;
  version?: string;
  author?: string;
}

export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  symbol?: string;
  timeframe?: string;
  initialCapital: number;
}

export interface BacktestResults {
  startCapital: number | string;
  endCapital: number | string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number | string;
  maxDrawdown: number | string;
  sharpeRatio: number;
  signalsGenerated: number;
  executedOrders?: any[];
  completed_trades?: any[];
  finalPortfolio?: any;
  daily_returns?: Array<{ timestamp: string; value: number }>;
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'OUTPUT' | 'ORDER' | 'TRADE';
  message: string;
}

interface OrchestratorContextType {
  // Core state
  mode: 'backtest' | 'paper' | 'live';
  isConnected: boolean;

  // Strategies
  strategies: StrategyInfo[];
  selectedStrategy: StrategyInfo | null;

  // Backtest
  backtestConfig: BacktestConfig;
  backtestResults: BacktestResults | null;
  isBacktestRunning: boolean;
  backtestLogs: string[];

  // Logs
  logs: LogEntry[];

  // Actions
  setMode: (mode: 'backtest' | 'paper' | 'live') => void;
  setIsConnected: (connected: boolean) => void;
  setStrategies: (strategies: StrategyInfo[]) => void;
  setSelectedStrategy: (strategy: StrategyInfo | null) => void;
  setBacktestConfig: (config: BacktestConfig) => void;
  setBacktestResults: (results: BacktestResults | null) => void;
  setIsBacktestRunning: (running: boolean) => void;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
}

const OrchestratorContext = createContext<OrchestratorContextType | undefined>(undefined);

// LocalStorage keys
const STORAGE_KEYS = {
  mode: 'orchestrator_mode',
  selectedStrategy: 'orchestrator_selectedStrategy',
  backtestConfig: 'orchestrator_backtestConfig',
};

// Default backtest config
const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  startDate: new Date(new Date().setMonth(new Date().getMonth() - 6)), // 6 months ago
  endDate: new Date(),
  symbol: 'EURUSD',
  timeframe: '1h',
  initialCapital: 10000,
};

export const OrchestratorProvider = ({ children }: { children: ReactNode }) => {
  // Initialize state from localStorage or defaults
  const [mode, setMode] = useState<'backtest' | 'paper' | 'live'>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.mode);
    return (stored as 'backtest' | 'paper' | 'live') || 'backtest';
  });

  const [isConnected, setIsConnected] = useState(false);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);

  const [selectedStrategy, setSelectedStrategy] = useState<StrategyInfo | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.selectedStrategy);
    return stored ? JSON.parse(stored) : null;
  });

  const [backtestConfig, setBacktestConfig] = useState<BacktestConfig>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.backtestConfig);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Convert date strings back to Date objects
      return {
        ...parsed,
        startDate: new Date(parsed.startDate),
        endDate: new Date(parsed.endDate),
      };
    }
    return DEFAULT_BACKTEST_CONFIG;
  });

  const [backtestResults, setBacktestResults] = useState<BacktestResults | null>(null);
  const [isBacktestRunning, setIsBacktestRunning] = useState(false);
  const [backtestLogs, _setBacktestLogs] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Persist to localStorage when values change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.mode, mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.selectedStrategy, JSON.stringify(selectedStrategy));
  }, [selectedStrategy]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.backtestConfig, JSON.stringify(backtestConfig));
  }, [backtestConfig]);

  const addLog = (log: LogEntry) => {
    setLogs((prev) => [...prev, log]);
  };

  const clearLogs = () => {
    setLogs([]);
  };

  return (
    <OrchestratorContext.Provider
      value={{
        // State
        mode,
        isConnected,
        strategies,
        selectedStrategy,
        backtestConfig,
        backtestResults,
        isBacktestRunning,
        backtestLogs,
        logs,

        // Actions
        setMode,
        setIsConnected,
        setStrategies,
        setSelectedStrategy,
        setBacktestConfig,
        setBacktestResults,
        setIsBacktestRunning,
        addLog,
        clearLogs,
      }}
    >
      {children}
    </OrchestratorContext.Provider>
  );
};

export const useOrchestrator = () => {
  const context = useContext(OrchestratorContext);
  if (!context) throw new Error('useOrchestrator must be used within OrchestratorProvider');
  return context;
};
