import { useState } from 'react';
import { Button, Paper, Text, Stack, Code, Group } from '@mantine/core';
import { invoke } from '@tauri-apps/api/core';

export const OrchestratorTestPage = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestResult, setBacktestResult] = useState<any>(null);

  const testLoadStrategy = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await invoke('test_orchestrator_load', {
        strategyName: 'ma_crossover_strategy'
      });
      setResult(response);
    } catch (e) {
      setError(e as string);
    } finally {
      setLoading(false);
    }
  };

  const runBacktest = async () => {
    setBacktestLoading(true);
    setError(null);
    setBacktestResult(null);

    try {
      const response = await invoke('run_orchestrator_backtest', {
        strategyName: 'ma_crossover_strategy',
        dataset: 'EURUSD_1h_2024-01-02_2024-05-31.parquet' // Use a real dataset if available
      });
      setBacktestResult(response);
    } catch (e) {
      setError(e as string);
    } finally {
      setBacktestLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <Text size="xl" fw={700} mb="xl">Orchestrator Test</Text>
      
      <Stack gap="xl">
        {/* Chunk #1: Load Strategy */}
        <Paper p="lg" style={{ backgroundColor: '#1a1a1a' }}>
          <Stack gap="md">
            <Text fw={600}>Chunk #1: Load Strategy</Text>
            <Text size="sm" c="dimmed">Test loading a strategy YAML file</Text>
            
            <Group>
              <Button 
                onClick={testLoadStrategy} 
                loading={loading}
                color="blue"
              >
                Load MA Crossover Strategy
              </Button>
            </Group>

          {error && (
            <Paper p="md" style={{ backgroundColor: '#2a1a1a', border: '1px solid red' }}>
              <Text c="red" size="sm">Error: {error}</Text>
            </Paper>
          )}

          {result && (
            <Paper p="md" style={{ backgroundColor: '#1a2a1a', border: '1px solid green' }}>
              <Stack gap="xs">
                <Text fw={600} c="green">Success!</Text>
                <Text size="sm">Strategy: {result.strategy.name} v{result.strategy.version}</Text>
                <Text size="sm">Author: {result.strategy.author}</Text>
                <Text size="sm" c="dimmed">{result.strategy.description}</Text>
                <Text size="sm">Indicators: {result.strategy.indicators.length}</Text>
                <Text size="sm">Signals: {result.strategy.signals.length}</Text>
                <Text size="sm">Parameters: {result.strategy.parameter_count}</Text>
                <Text size="sm">Risk Rules: {result.strategy.risk_rules}</Text>
                
                <Text size="sm" fw={600} mt="md">Full Summary:</Text>
                <Code block style={{ backgroundColor: '#0a0a0a' }}>
                  {result.summary}
                </Code>
              </Stack>
            </Paper>
          )}
          </Stack>
        </Paper>

        {/* Chunk #2: Run Backtest */}
        <Paper p="lg" style={{ backgroundColor: '#1a1a1a' }}>
          <Stack gap="md">
            <Text fw={600}>Chunk #2: Run Backtest</Text>
            <Text size="sm" c="dimmed">Test running a backtest with data source configuration</Text>
            
            <Group>
              <Button 
                onClick={runBacktest} 
                loading={backtestLoading}
                color="green"
                disabled={!result} // Must load strategy first
              >
                Run Backtest
              </Button>
            </Group>

            {backtestResult && (
              <Paper p="md" style={{ backgroundColor: '#1a2a1a', border: '1px solid green' }}>
                <Stack gap="xs">
                  <Text fw={600} c="green">Backtest Complete!</Text>
                  <Text size="sm">Initial Capital: ${backtestResult.result.start_capital}</Text>
                  <Text size="sm">Final Capital: ${backtestResult.result.end_capital}</Text>
                  <Text size="sm">Total Trades: {backtestResult.result.total_trades}</Text>
                  <Text size="sm">Winning Trades: {backtestResult.result.winning_trades}</Text>
                  <Text size="sm">Losing Trades: {backtestResult.result.losing_trades}</Text>
                  <Text size="sm">Total P&L: ${backtestResult.result.total_pnl}</Text>
                  <Text size="sm">Max Drawdown: ${backtestResult.result.max_drawdown}</Text>
                  <Text size="sm">Sharpe Ratio: {backtestResult.result.sharpe_ratio}</Text>
                  <Text size="sm">Signals Generated: {backtestResult.result.signals_generated}</Text>
                  
                  <Text size="xs" c="dimmed" mt="md">
                    Note: This is a mock result. Next chunk will actually run the components.
                  </Text>
                </Stack>
              </Paper>
            )}
          </Stack>
        </Paper>
      </Stack>
    </div>
  );
};