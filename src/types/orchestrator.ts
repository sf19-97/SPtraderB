export interface Strategy {
  name: string;
  version: string;
  author: string;
  description: string;
  path?: string;
  dependencies?: {
    indicators: string[];
    signals: string[];
  };
  parameters?: Record<string, any>;
}

export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  symbol: string;
  timeframe: string;
  initialCapital: number;
  dataSource: 'database' | 'parquet' | 'cache';
  parquetFile: string | null;
}

export interface BacktestResults {
  startCapital: number;
  endCapital: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  maxDrawdown: number;
  sharpeRatio: number;
  signalsGenerated?: any[] | number;
  executedOrders?: any[];
  completed_trades?: any[];
  finalPortfolio?: any;
  daily_returns?: any[];
  indicatorData?: Record<string, (number | null)[]>;
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SUCCESS' | 'TRADE' | 'ORDER' | 'OUTPUT';
  message: string;
}