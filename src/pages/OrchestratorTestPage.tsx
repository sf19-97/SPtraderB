import { useState, useEffect } from 'react';
import { Button, Paper, Text, Stack, Code, Group, ScrollArea } from '@mantine/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { IconArrowLeft } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

export const OrchestratorTestPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [logs, setLogs] = useState<Array<{level: string, message: string}>>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveRunning, setLiveRunning] = useState(false);
  const [portfolioState, setPortfolioState] = useState<any>(null);

  // Listen for log events
  useEffect(() => {
    const unlisten = listen('log', (event: any) => {
      setLogs(prev => [...prev, {
        level: event.payload.level,
        message: event.payload.message
      }]);
    });

    // Also listen for component output
    const unlistenOutput = listen('component-output', (event: any) => {
      if (event.payload.type === 'stdout') {
        setLogs(prev => [...prev, {
          level: 'OUTPUT',
          message: event.payload.line
        }]);
      }
    });

    // Listen for portfolio updates
    const unlistenPortfolio = listen('portfolio_update', (event: any) => {
      setPortfolioState(event.payload);
    });

    return () => {
      unlisten.then(fn => fn());
      unlistenOutput.then(fn => fn());
      unlistenPortfolio.then(fn => fn());
    };
  }, []);

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
    setLogs([]); // Clear logs

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

  const runLiveMode = async () => {
    setLiveLoading(true);
    setError(null);
    setLogs([]); // Clear logs
    setPortfolioState(null); // Reset portfolio

    try {
      const response = await invoke('run_orchestrator_live', {
        strategyName: 'ma_crossover_strategy',
        initialCapital: 10000
      });
      setLiveRunning(true);
    } catch (e) {
      setError(e as string);
    } finally {
      setLiveLoading(false);
    }
  };

  const getLogColor = (level: string) => {
    switch(level) {
      case 'ERROR': return 'red';
      case 'SUCCESS': return 'green';
      case 'INFO': return 'blue';
      case 'OUTPUT': return 'gray';
      case 'WARN': return 'yellow';
      case 'ORDER': return 'cyan';
      case 'TRADE': return 'green';
      default: return 'dimmed';
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <Group justify="space-between" mb="xl">
        <Text size="xl" fw={700}>Orchestrator Test</Text>
        <Button 
          leftSection={<IconArrowLeft size={16} />}
          variant="subtle"
          onClick={() => navigate('/')}
        >
          Back to Trading
        </Button>
      </Group>
      
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
                  
                  {backtestResult.result.executed_orders && backtestResult.result.executed_orders.length > 0 && (
                    <>
                      <Text size="sm" fw={600} mt="md">Executed Orders:</Text>
                      {backtestResult.result.executed_orders.map((order: any, idx: number) => (
                        <Paper key={idx} p="xs" style={{ backgroundColor: '#0a0a0a', marginTop: '0.5rem' }}>
                          <Text size="xs" c="green">
                            {order.side} {order.quantity} {order.symbol} @ Market
                          </Text>
                          <Text size="xs" c="dimmed">Entry: {order.metadata.entry_price}</Text>
                          <Text size="xs" c="dimmed">Stop Loss: {order.metadata.stop_loss}</Text>
                          <Text size="xs" c="dimmed">Take Profit: {order.metadata.take_profit}</Text>
                          <Text size="xs" c="dimmed">Signal: {order.metadata.signal_type}</Text>
                        </Paper>
                      ))}
                    </>
                  )}
                  
                  {backtestResult.result.final_portfolio && (
                    <>
                      <Text size="sm" fw={600} mt="md">Portfolio State:</Text>
                      <Paper p="xs" style={{ backgroundColor: '#0a0a0a', marginTop: '0.5rem' }}>
                        <Text size="xs">Cash: ${backtestResult.result.final_portfolio.cash}</Text>
                        <Text size="xs">Total Value: ${backtestResult.result.final_portfolio.total_value}</Text>
                        <Text size="xs">Positions: {Object.keys(backtestResult.result.final_portfolio.positions).length}</Text>
                        <Text size="xs">Max Drawdown: {(backtestResult.result.final_portfolio.max_drawdown * 100).toFixed(2)}%</Text>
                      </Paper>
                    </>
                  )}
                </Stack>
              </Paper>
            )}
          </Stack>
        </Paper>

        {/* Chunk #7: Live Mode */}
        <Paper p="lg" style={{ backgroundColor: '#1a1a1a' }}>
          <Stack gap="md">
            <Text fw={600}>Chunk #7: Live Mode</Text>
            <Text size="sm" c="dimmed">Test running orchestrator in live trading mode with Redis signals</Text>
            
            <Group>
              <Button 
                onClick={runLiveMode} 
                loading={liveLoading}
                color="red"
                disabled={!result || liveRunning} // Must load strategy first
              >
                {liveRunning ? 'Live Trading Active' : 'Start Live Trading'}
              </Button>
              {liveRunning && (
                <Button 
                  onClick={() => setLiveRunning(false)} 
                  variant="outline"
                  color="red"
                >
                  Stop Live Trading
                </Button>
              )}
            </Group>

            {portfolioState && (
              <Paper p="md" style={{ backgroundColor: '#1a2a1a', border: '1px solid green' }}>
                <Stack gap="xs">
                  <Text fw={600} c="green">Live Portfolio State</Text>
                  <Text size="sm">Cash: ${portfolioState.cash}</Text>
                  <Text size="sm">Total Value: ${portfolioState.total_value}</Text>
                  <Text size="sm">Positions: {portfolioState.positions}</Text>
                  <Text size="sm">Daily P&L: ${portfolioState.daily_pnl}</Text>
                  <Text size="sm">Total P&L: ${portfolioState.total_pnl}</Text>
                  <Text size="sm">Max Drawdown: {portfolioState.max_drawdown}%</Text>
                </Stack>
              </Paper>
            )}
            
            {/* Live Mode Instructions */}
            {liveRunning && (
              <Paper p="md" style={{ backgroundColor: '#0a0a0a', marginTop: '1rem' }}>
                <Text fw={600} mb="sm">Testing Live Mode</Text>
                <Text size="sm" c="dimmed">
                  To test live signals, run this Python command in a terminal:
                </Text>
                <Code block style={{ backgroundColor: '#0a0a0a', marginTop: '0.5rem' }}>
                  {`cd workspace/core/data
python signal_publisher.py`}
                </Code>
                <Text size="sm" c="dimmed" mt="sm">
                  This will publish test signals to Redis for the orchestrator to process.
                </Text>
              </Paper>
            )}

            {/* Live Mode Logs */}
            {liveRunning && logs.length > 0 && (
              <Paper p="md" style={{ backgroundColor: '#0a0a0a', marginTop: '1rem' }}>
                <Text fw={600} mb="sm">Live Trading Logs</Text>
                <ScrollArea h={300}>
                  <Stack gap="xs">
                    {logs.map((log, index) => (
                      <Text key={index} size="xs" c={getLogColor(log.level)} style={{ fontFamily: 'monospace' }}>
                        [{log.level}] {log.message}
                      </Text>
                    ))}
                  </Stack>
                </ScrollArea>
              </Paper>
            )}
          </Stack>
        </Paper>
      </Stack>
    </div>
  );
};