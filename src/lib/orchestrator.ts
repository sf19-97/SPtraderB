import { orchestratorApi } from '../api/workspace';

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
  console.log('[Orchestrator] Running backtest:', config);

  // Convert to ISO 8601 strings
  const startDate = new Date(config.startDate).toISOString();
  const endDate = new Date(config.endDate).toISOString();

  // Start the backtest
  const response = await orchestratorApi.runBacktest({
    strategy_name: config.strategyName,
    start_date: startDate,
    end_date: endDate,
    symbol: config.symbol,
    timeframe: config.timeframe,
    initial_capital: config.initialCapital,
  });

  console.log('[Orchestrator] Backtest started:', response.backtest_id);

  // Poll for completion
  const backtestId = response.backtest_id;
  let status = await orchestratorApi.getBacktestStatus(backtestId);

  while (status.status === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
    status = await orchestratorApi.getBacktestStatus(backtestId);
    console.log('[Orchestrator] Backtest status:', status);
  }

  // Get final results
  const results = await orchestratorApi.getBacktestResults(backtestId);
  console.log('[Orchestrator] Backtest completed:', results);

  // Convert to expected format
  return {
    backtest_id: results.backtest_id,
    result: {
      start_capital: results.start_capital,
      end_capital: results.end_capital,
      total_trades: results.total_trades,
      winning_trades: results.winning_trades,
      losing_trades: results.losing_trades,
      total_pnl: results.total_pnl,
      max_drawdown: results.max_drawdown,
      sharpe_ratio: results.sharpe_ratio,
      signals_generated: results.signals_generated,
    },
  };
}

// Load a strategy YAML file
export async function loadStrategy(strategyName: string): Promise<any> {
  // Strategy loading is now handled by workspaceApi.readFile()
  // This function is kept for backwards compatibility but should be replaced
  console.warn('[Orchestrator] loadStrategy() is deprecated, use workspaceApi.readFile() instead');
  throw new Error('Not implemented - use workspaceApi.readFile() instead');
}

// Start live trading mode
export async function startLiveTrading(
  strategyName: string,
  initialCapital: number
): Promise<void> {
  // Live trading is not yet implemented in the HTTP API
  console.warn('[Orchestrator] Live trading not yet implemented in HTTP API');
  throw new Error('Live trading not yet implemented');
}

// Stop live trading mode
export async function stopLiveTrading(): Promise<void> {
  // Live trading is not yet implemented in the HTTP API
  console.warn('[Orchestrator] Live trading not yet implemented in HTTP API');
  throw new Error('Live trading not yet implemented');
}

// Cancel a running backtest
export async function cancelBacktest(backtestId: string): Promise<void> {
  return await orchestratorApi.cancelBacktest(backtestId);
}
