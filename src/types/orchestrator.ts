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
  signals_generated?: any[]; // Snake case version from Rust
  executedOrders?: any[];
  executed_orders?: any[]; // Snake case version from Rust
  completed_trades?: any[];
  finalPortfolio?: any;
  final_portfolio?: any; // Snake case version from Rust
  daily_returns?: any[];
  indicatorData?: Record<string, (number | null)[]>;
  indicator_data?: Record<string, (number | null)[]>; // Snake case version from Rust
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SUCCESS' | 'TRADE' | 'ORDER' | 'OUTPUT';
  message: string;
}
