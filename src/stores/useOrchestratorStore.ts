import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { BacktestConfig, BacktestResults, Strategy, LogEntry } from '../types/orchestrator';

// Portfolio related types
interface Position {
  id: string;
  symbol: string;
  side: 'Long' | 'Short';
  entry_price: number;
  size: number;
  entry_time: string;
  triggering_signal: string;
  stop_loss?: number;
  take_profit?: number;
}

interface PortfolioState {
  cash: number;
  positions: Record<string, Position>;
  total_value: number;
  daily_pnl: number;
  total_pnl: number;
  max_drawdown: number;
  high_water_mark: number;
  initial_capital: number;
  current_date: string;
}

interface OrchestratorState {
  // Mode
  mode: 'backtest' | 'paper' | 'live';

  // Strategies
  strategies: Strategy[];
  selectedStrategy: Strategy | null;
  isLoadingStrategies: boolean;

  // Backtest
  backtestConfig: BacktestConfig;
  backtestResults: BacktestResults | null;
  isBacktestRunning: boolean;
  currentBacktestId: string | null;

  // Live Trading
  isConnected: boolean;
  portfolioState: PortfolioState | null;

  // Logs
  logs: LogEntry[];
  maxLogs: number;

  // UI Navigation
  activeResultsTab: string;
  highlightedTradeId: string | null;

  // Actions
  setMode: (mode: 'backtest' | 'paper' | 'live') => void;
  setStrategies: (strategies: Strategy[]) => void;
  setSelectedStrategy: (strategy: Strategy | null) => void;
  setIsLoadingStrategies: (loading: boolean) => void;
  updateBacktestConfig: (updates: Partial<BacktestConfig>) => void;
  setBacktestResults: (results: BacktestResults | null) => void;
  setIsBacktestRunning: (running: boolean) => void;
  setCurrentBacktestId: (id: string | null) => void;
  setIsConnected: (connected: boolean) => void;
  setPortfolioState: (state: PortfolioState | null) => void;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
  reset: () => void;

  // UI Navigation Actions
  setActiveResultsTab: (tab: string) => void;
  highlightTrade: (tradeId: string | null) => void;
  navigateToTrade: (tradeId: string, tab: 'chart' | 'trades') => void;
}

const initialBacktestConfig: BacktestConfig = {
  startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
  endDate: new Date(),
  symbol: 'EURUSD',
  timeframe: '1h',
  initialCapital: 10000,
  dataSource: 'database',
  parquetFile: null,
};

const initialState = {
  mode: 'backtest' as const,
  strategies: [],
  selectedStrategy: null,
  isLoadingStrategies: false,
  backtestConfig: initialBacktestConfig,
  backtestResults: null,
  isBacktestRunning: false,
  currentBacktestId: null,
  isConnected: false,
  portfolioState: null,
  logs: [],
  maxLogs: 1000,
  activeResultsTab: 'overview',
  highlightedTradeId: null,
};

export const useOrchestratorStore = create<OrchestratorState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // Actions
        setMode: (mode) => set({ mode }),

        setStrategies: (strategies) => set({ strategies }),

        setSelectedStrategy: (strategy) => set({ selectedStrategy: strategy }),

        setIsLoadingStrategies: (loading) => set({ isLoadingStrategies: loading }),

        updateBacktestConfig: (updates) =>
          set((state) => ({
            backtestConfig: { ...state.backtestConfig, ...updates },
          })),

        setBacktestResults: (results) => set({ backtestResults: results }),

        setIsBacktestRunning: (running) => set({ isBacktestRunning: running }),

        setCurrentBacktestId: (id) => set({ currentBacktestId: id }),

        setIsConnected: (connected) => set({ isConnected: connected }),

        setPortfolioState: (portfolioState) => set({ portfolioState }),

        addLog: (log) =>
          set((state) => {
            const newLogs = [...state.logs, log];
            // Keep only the last maxLogs entries
            if (newLogs.length > state.maxLogs) {
              newLogs.splice(0, newLogs.length - state.maxLogs);
            }
            return { logs: newLogs };
          }),

        clearLogs: () => set({ logs: [] }),

        reset: () => set(initialState),

        // UI Navigation Actions
        setActiveResultsTab: (tab) => set({ activeResultsTab: tab }),

        highlightTrade: (tradeId) => set({ highlightedTradeId: tradeId }),

        navigateToTrade: (tradeId, tab) =>
          set({
            highlightedTradeId: tradeId,
            activeResultsTab: tab,
          }),
      }),
      {
        name: 'orchestrator-store',
        partialize: (state) => ({
          // Only persist UI preferences, not runtime state
          mode: state.mode,
          backtestConfig: state.backtestConfig,
          selectedStrategy: state.selectedStrategy,
        }),
      }
    )
  )
);
