import { invoke } from '@tauri-apps/api/core';

export interface BacktestConfig {
  strategyName: string;
  startDate: string;
  endDate: string;
  symbol: string;
  timeframe: string;
  initialCapital: number;
}

export interface BacktestResult {
  strategy?: any;
  backtest_id?: string;
  result: {
    start_capital: number;
    end_capital: number;
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    total_pnl: number;
    max_drawdown: number;
    sharpe_ratio: number;
    signals_generated: number;
    executed_orders?: any[];
    completed_trades?: any[];
    final_portfolio?: any;
    daily_returns?: Array<{ timestamp: string; value: number }>;
  };
}

// Run a backtest with the specified configuration
export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  // Use setTimeout to make this truly async and not block the UI
  return new Promise((resolve, reject) => {
    // Allow UI to update before starting the heavy operation
    setTimeout(async () => {
      try {
        const result = await invoke('run_orchestrator_backtest', {
          strategyName: config.strategyName,
          symbol: config.symbol,
          timeframe: config.timeframe,
          startDate: config.startDate,
          endDate: config.endDate,
          initialCapital: config.initialCapital,
        });
        resolve(result as BacktestResult);
      } catch (error) {
        reject(error);
      }
    }, 10);
  });
}

// Load a strategy YAML file
export async function loadStrategy(strategyName: string): Promise<any> {
  return await invoke('test_orchestrator_load', { strategyName });
}

// Start live trading mode
export async function startLiveTrading(
  strategyName: string,
  initialCapital: number
): Promise<void> {
  return await invoke('run_orchestrator_live', { strategyName, initialCapital });
}

// Stop live trading mode
export async function stopLiveTrading(): Promise<void> {
  // TODO: Implement stop command in Rust
  console.log('Stopping live trading...');
}

// Cancel a running backtest
export async function cancelBacktest(backtestId: string): Promise<void> {
  return await invoke('cancel_backtest', { backtestId });
}
