import { Button, Group, Paper, Progress, Text, Stack } from '@mantine/core';
import { IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useOrchestratorStore } from '../../../stores/useOrchestratorStore';
import { runBacktest, cancelBacktest } from '../../../lib/orchestrator';
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

export function BacktestRunner() {
  const {
    selectedStrategy,
    backtestConfig,
    isBacktestRunning,
    setIsBacktestRunning,
    currentBacktestId,
    setCurrentBacktestId,
    setBacktestResults,
    addLog,
    clearLogs,
  } = useOrchestratorStore();

  // Listen for backtest started event (only in Tauri environment)
  useEffect(() => {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const unlisten = listen('backtest_started', (event: any) => {
        if (event.payload && event.payload.backtest_id) {
          setCurrentBacktestId(event.payload.backtest_id);
        }
      });

      return () => {
        unlisten.then((fn) => fn());
      };
    }
  }, [setCurrentBacktestId]);

  const handleRunBacktest = async () => {
    if (!selectedStrategy) {
      notifications.show({
        title: 'No Strategy Selected',
        message: 'Please select a strategy before running a backtest',
        color: 'red',
      });
      return;
    }

    // Validate configuration
    if (!backtestConfig.symbol || !backtestConfig.timeframe) {
      notifications.show({
        title: 'Invalid Configuration',
        message: 'Please select a symbol and timeframe',
        color: 'red',
      });
      return;
    }

    setIsBacktestRunning(true);
    // Don't clear results - keep showing previous results while running
    // setBacktestResults(null);
    setCurrentBacktestId(null);
    clearLogs();

    addLog({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: `Starting backtest with strategy: ${selectedStrategy.name}`,
    });

    try {
      // Ensure dates are Date objects
      const startDate =
        backtestConfig.startDate instanceof Date
          ? backtestConfig.startDate
          : new Date(backtestConfig.startDate);
      const endDate =
        backtestConfig.endDate instanceof Date
          ? backtestConfig.endDate
          : new Date(backtestConfig.endDate);

      const result = await runBacktest({
        strategyName: selectedStrategy.name.replace('.yaml', ''),
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        symbol: backtestConfig.symbol,
        timeframe: backtestConfig.timeframe,
        initialCapital: backtestConfig.initialCapital,
      });

      // Map snake_case from Rust to camelCase for TypeScript
      const backtestResult = result.result as any;
      setBacktestResults({
        startCapital: backtestResult.start_capital,
        endCapital: backtestResult.end_capital,
        totalTrades: backtestResult.total_trades,
        winningTrades: backtestResult.winning_trades,
        losingTrades: backtestResult.losing_trades,
        totalPnl: backtestResult.total_pnl,
        maxDrawdown: backtestResult.max_drawdown,
        sharpeRatio: backtestResult.sharpe_ratio,
        signalsGenerated: backtestResult.signals_generated,
        executedOrders: backtestResult.executed_orders,
        completed_trades: backtestResult.completed_trades,
        finalPortfolio: backtestResult.final_portfolio,
        daily_returns: backtestResult.daily_returns,
        indicatorData: backtestResult.indicator_data || {},
      });

      addLog({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: `Backtest completed successfully`,
      });

      const pnl =
        typeof result.result.total_pnl === 'string'
          ? parseFloat(result.result.total_pnl)
          : result.result.total_pnl;
      notifications.show({
        title: 'Backtest Complete',
        message: `Final P&L: $${pnl.toFixed(2)}`,
        color: pnl >= 0 ? 'green' : 'red',
      });
    } catch (error) {
      console.error('Backtest failed:', error);

      addLog({
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        message: `Backtest failed: ${error}`,
      });

      notifications.show({
        title: 'Backtest Failed',
        message: String(error),
        color: 'red',
      });
    } finally {
      setIsBacktestRunning(false);
      setCurrentBacktestId(null);
    }
  };

  const handleCancel = async () => {
    if (!currentBacktestId) {
      console.error('No backtest ID to cancel');
      return;
    }

    try {
      await cancelBacktest(currentBacktestId);

      addLog({
        timestamp: new Date().toISOString(),
        level: 'WARN',
        message: 'Backtest cancelled by user',
      });

      notifications.show({
        title: 'Backtest Cancelled',
        message: 'The backtest was cancelled successfully',
        color: 'yellow',
      });
    } catch (error) {
      console.error('Failed to cancel backtest:', error);
      notifications.show({
        title: 'Cancel Failed',
        message: 'Failed to cancel the backtest',
        color: 'red',
      });
    } finally {
      setIsBacktestRunning(false);
      setCurrentBacktestId(null);
    }
  };

  return (
    <Stack gap="md">
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={600}>Backtest Execution</Text>
            <Group>
              <Button
                leftSection={<IconPlayerPlay size={16} />}
                onClick={handleRunBacktest}
                loading={isBacktestRunning}
                disabled={!selectedStrategy}
                color="green"
              >
                Run Backtest
              </Button>
              {isBacktestRunning && (
                <Button
                  leftSection={<IconPlayerStop size={16} />}
                  onClick={handleCancel}
                  color="red"
                  variant="outline"
                >
                  Cancel
                </Button>
              )}
            </Group>
          </Group>

          {isBacktestRunning && (
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                Running backtest...
              </Text>
              <Progress value={30} animated />
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
