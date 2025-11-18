import {
  Paper,
  Grid,
  Group,
  Text,
  ThemeIcon,
  Stack,
  Progress,
  Tabs,
  ScrollArea,
  Badge,
  Button,
  LoadingOverlay,
} from '@mantine/core';
import {
  IconTrendingUp,
  IconTrendingDown,
  IconChartLine,
  IconPercentage,
  IconCoin,
  IconChartBar,
  IconChartCandle,
  IconHistory,
  IconFileText,
} from '@tabler/icons-react';
import { useOrchestratorStore } from '../../../stores/useOrchestratorStore';
import { OrchestratorChart } from '../OrchestratorChart';
import { TradeHistory } from './TradeHistory';
import { useState, useMemo, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { notifications } from '@mantine/notifications';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
}

function StatCard({ title, value, icon, color, subtitle }: StatCardProps) {
  return (
    <Paper p="md" withBorder>
      <Group>
        <ThemeIcon color={color} size="xl" radius="md" variant="light">
          {icon}
        </ThemeIcon>
        <div style={{ flex: 1 }}>
          <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
            {title}
          </Text>
          <Text fw={700} size="xl">
            {value}
          </Text>
          {subtitle && (
            <Text c="dimmed" size="xs">
              {subtitle}
            </Text>
          )}
        </div>
      </Group>
    </Paper>
  );
}

export function BacktestResults() {
  const {
    backtestResults,
    backtestConfig,
    logs,
    clearLogs,
    isBacktestRunning,
    activeResultsTab,
    setActiveResultsTab,
    highlightedTradeId: _highlightedTradeId,
    highlightTrade,
  } = useOrchestratorStore();
  const [marketData, setMarketData] = useState<any>(null);
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);

  const getLogColor = (level: string) => {
    switch (level) {
      case 'ERROR':
        return 'red';
      case 'WARN':
        return 'yellow';
      case 'INFO':
        return 'blue';
      case 'DEBUG':
        return 'gray';
      case 'OUTPUT':
        return 'gray';
      case 'SUCCESS':
        return 'green';
      case 'ORDER':
        return 'cyan';
      case 'TRADE':
        return 'green';
      default:
        return 'dimmed';
    }
  };

  // Don't return null - always show the tabs structure

  // Convert string values to numbers (only if we have results)
  const startCapital = backtestResults
    ? typeof backtestResults.startCapital === 'string'
      ? parseFloat(backtestResults.startCapital)
      : backtestResults.startCapital
    : 0;
  const endCapital = backtestResults
    ? typeof backtestResults.endCapital === 'string'
      ? parseFloat(backtestResults.endCapital)
      : backtestResults.endCapital
    : 0;
  const totalPnl = backtestResults
    ? typeof backtestResults.totalPnl === 'string'
      ? parseFloat(backtestResults.totalPnl)
      : backtestResults.totalPnl
    : 0;
  const maxDrawdown = backtestResults
    ? typeof backtestResults.maxDrawdown === 'string'
      ? parseFloat(backtestResults.maxDrawdown)
      : backtestResults.maxDrawdown
    : 0;

  const totalReturn = startCapital > 0 ? ((endCapital - startCapital) / startCapital) * 100 : 0;
  const winRate =
    backtestResults && backtestResults.totalTrades > 0
      ? (backtestResults.winningTrades / backtestResults.totalTrades) * 100
      : 0;

  // Transform trade data for the chart
  const chartTrades = useMemo(() => {
    if (!backtestResults) return [];

    // Check if we have completed trades from the backtest
    if ('completed_trades' in backtestResults && Array.isArray(backtestResults.completed_trades)) {
      return backtestResults.completed_trades.map((trade: any) => ({
        id: trade.id,
        symbol: trade.symbol,
        entryTime: trade.entry_time,
        exitTime: trade.exit_time,
        entryPrice:
          typeof trade.entry_price === 'string' ? parseFloat(trade.entry_price) : trade.entry_price,
        exitPrice:
          typeof trade.exit_price === 'string' ? parseFloat(trade.exit_price) : trade.exit_price,
        size: typeof trade.quantity === 'string' ? parseFloat(trade.quantity) : trade.quantity,
        side: (trade.side?.toLowerCase() === 'long' ? 'long' : 'short') as 'long' | 'short',
        pnl: typeof trade.pnl === 'string' ? parseFloat(trade.pnl) : trade.pnl,
        pnlPercent:
          typeof trade.pnl_percent === 'string' ? parseFloat(trade.pnl_percent) : trade.pnl_percent,
        exitReason: trade.exit_reason,
        holdingPeriod: trade.holding_period_hours,
      }));
    }

    // Fallback: Try to reconstruct from executed orders if no completed trades
    if (backtestResults.executedOrders && backtestResults.executedOrders.length > 0) {
      return []; // We can't properly reconstruct trades from orders alone
    }

    return [];
  }, [backtestResults]);

  // Generate equity curve data
  const equityCurve = useMemo(() => {
    // Use daily returns if available
    if (backtestResults?.daily_returns && backtestResults.daily_returns.length > 0) {
      const timestamps: string[] = [];
      const values: number[] = [];
      let currentValue = startCapital;

      // Add starting point
      timestamps.push(backtestResults.daily_returns[0].timestamp);
      values.push(startCapital);

      // Calculate equity curve from daily returns
      backtestResults.daily_returns.forEach((dr: any) => {
        const returnValue = typeof dr.value === 'string' ? parseFloat(dr.value) : dr.value;
        currentValue = currentValue * (1 + returnValue);
        timestamps.push(dr.timestamp);
        values.push(currentValue);
      });

      return { timestamps, values };
    }

    // Fallback: Create a simple linear progression if no daily returns
    const timestamps = [
      new Date(backtestConfig.startDate).toISOString(),
      new Date(backtestConfig.endDate).toISOString(),
    ];
    const values = [startCapital, endCapital];

    return { timestamps, values };
  }, [backtestResults?.daily_returns, startCapital, endCapital, backtestConfig]);

  // Load market data when chart tab is selected or backtest results change
  useEffect(() => {
    if (activeResultsTab === 'chart' && backtestConfig && backtestResults) {
      // Clear old data and reload when backtest results change
      setMarketData(null);
      loadMarketData();
    }
  }, [activeResultsTab, backtestConfig, backtestResults]);

  // Clear highlight when switching away from chart/trades tabs
  useEffect(() => {
    if (activeResultsTab !== 'chart' && activeResultsTab !== 'trades') {
      highlightTrade(null);
    }
  }, [activeResultsTab, highlightTrade]);

  const loadMarketData = async () => {
    setIsLoadingChart(true);

    try {
      // Always fetch from database/cache using the same mechanism as AdaptiveChart
      const fromTimestamp = Math.floor(new Date(backtestConfig.startDate).getTime() / 1000);
      const toTimestamp = Math.floor(new Date(backtestConfig.endDate).getTime() / 1000);

      const candles = await invoke('fetch_candles', {
        request: {
          symbol: backtestConfig.symbol,
          timeframe: backtestConfig.timeframe,
          from: fromTimestamp,
          to: toTimestamp,
        },
      });

      // Convert to chart data format
      if (Array.isArray(candles) && candles.length > 0) {
        const chartData: any = {
          // Convert Unix timestamps to ISO date strings
          time: candles.map((c) => new Date(c.time * 1000).toISOString()),
          open: candles.map((c) => c.open),
          high: candles.map((c) => c.high),
          low: candles.map((c) => c.low),
          close: candles.map((c) => c.close),
          volume: candles.map((c) => c.volume),
        };

        // Add signals if available
        if (backtestResults?.signalsGenerated && Array.isArray(backtestResults.signalsGenerated)) {
          const crossovers: number[] = new Array(candles.length).fill(0);
          const types: string[] = new Array(candles.length).fill('');

          // Map signals to candle indices
          backtestResults.signalsGenerated.forEach((signal: any) => {
            const signalTime = new Date(signal.timestamp).getTime();
            const candleIndex = candles.findIndex((c) => c.time * 1000 >= signalTime);

            if (candleIndex >= 0) {
              crossovers[candleIndex] = signal.signal_type === 'golden_cross' ? 1 : -1;
              types[candleIndex] = signal.signal_type;
            }
          });

          chartData.signals = { crossovers, types };
        }

        // Add indicator data if available
        if (backtestResults?.indicatorData) {
          chartData.indicators = {};

          // Convert indicator data to chart format
          Object.entries(backtestResults.indicatorData).forEach(([name, values]) => {
            // The values array should match the candle length
            if (Array.isArray(values)) {
              chartData.indicators[name] = values;
            }
          });
        }

        setMarketData(chartData);
      } else {
        throw new Error('No data available for the selected period');
      }
    } catch (error) {
      console.error('Failed to load market data:', error);
      notifications.show({
        title: 'Failed to load chart data',
        message: String(error),
        color: 'red',
      });
    } finally {
      setIsLoadingChart(false);
    }
  };

  return (
    <Tabs value={activeResultsTab} onChange={(value) => value && setActiveResultsTab(value)}>
      <Tabs.List>
        <Tabs.Tab value="overview" leftSection={<IconChartBar size={16} />}>
          Overview
        </Tabs.Tab>
        <Tabs.Tab value="chart" leftSection={<IconChartCandle size={16} />}>
          Chart
        </Tabs.Tab>
        <Tabs.Tab value="trades" leftSection={<IconHistory size={16} />}>
          Trades
        </Tabs.Tab>
        <Tabs.Tab value="logs" leftSection={<IconFileText size={16} />}>
          Logs
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="overview" pt="md">
        {backtestResults ? (
          <div style={{ position: 'relative' }}>
            <LoadingOverlay visible={isBacktestRunning} loaderProps={{ size: 'lg' }} />
            <Stack gap="md">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <StatCard
                    title="Final Value"
                    value={`$${endCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    icon={<IconCoin size={28} />}
                    color="blue"
                    subtitle={`Started with $${startCapital.toLocaleString()}`}
                  />
                </Grid.Col>

                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <StatCard
                    title="Total Return"
                    value={`${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`}
                    icon={
                      totalReturn >= 0 ? (
                        <IconTrendingUp size={28} />
                      ) : (
                        <IconTrendingDown size={28} />
                      )
                    }
                    color={totalReturn >= 0 ? 'green' : 'red'}
                  />
                </Grid.Col>

                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <StatCard
                    title="Sharpe Ratio"
                    value={backtestResults?.sharpeRatio?.toFixed(2) || '0.00'}
                    icon={<IconChartLine size={28} />}
                    color="indigo"
                    subtitle="Risk-adjusted returns"
                  />
                </Grid.Col>

                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <StatCard
                    title="Max Drawdown"
                    value={`${(maxDrawdown * 100).toFixed(2)}%`}
                    icon={<IconTrendingDown size={28} />}
                    color="orange"
                    subtitle="Peak to trough"
                  />
                </Grid.Col>

                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <StatCard
                    title="Win Rate"
                    value={`${winRate.toFixed(1)}%`}
                    icon={<IconPercentage size={28} />}
                    color="teal"
                    subtitle={`${backtestResults?.winningTrades || 0}/${backtestResults?.totalTrades || 0} trades`}
                  />
                </Grid.Col>

                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <StatCard
                    title="Total Trades"
                    value={backtestResults?.totalTrades || 0}
                    icon={<IconChartBar size={28} />}
                    color="violet"
                    subtitle={`${backtestResults?.signalsGenerated || 0} signals generated`}
                  />
                </Grid.Col>
              </Grid>

              {/* Win/Loss Distribution */}
              <Paper p="md" withBorder>
                <Stack gap="sm">
                  <Text fw={600}>Trade Distribution</Text>
                  <Group justify="space-between">
                    <Text size="sm" c="green">
                      Winning: {backtestResults?.winningTrades || 0}
                    </Text>
                    <Text size="sm" c="red">
                      Losing: {backtestResults?.losingTrades || 0}
                    </Text>
                  </Group>
                  <Progress
                    size="xl"
                    value={
                      backtestResults?.totalTrades > 0
                        ? (backtestResults.winningTrades / backtestResults.totalTrades) * 100
                        : 0
                    }
                    color="green"
                  />
                </Stack>
              </Paper>

              {/* Portfolio State */}
              {backtestResults?.finalPortfolio && (
                <Paper p="md" withBorder>
                  <Stack gap="sm">
                    <Text fw={600}>Final Portfolio State</Text>
                    <Grid>
                      <Grid.Col span={6}>
                        <Text size="sm" c="dimmed">
                          Cash Balance
                        </Text>
                        <Text fw={600}>
                          $
                          {(typeof backtestResults.finalPortfolio.cash === 'string'
                            ? parseFloat(backtestResults.finalPortfolio.cash)
                            : backtestResults.finalPortfolio.cash
                          ).toFixed(2)}
                        </Text>
                      </Grid.Col>
                      <Grid.Col span={6}>
                        <Text size="sm" c="dimmed">
                          Portfolio Value
                        </Text>
                        <Text fw={600}>
                          $
                          {(typeof backtestResults.finalPortfolio.total_value === 'string'
                            ? parseFloat(backtestResults.finalPortfolio.total_value)
                            : backtestResults.finalPortfolio.total_value
                          ).toFixed(2)}
                        </Text>
                      </Grid.Col>
                      <Grid.Col span={6}>
                        <Text size="sm" c="dimmed">
                          Open Positions
                        </Text>
                        <Text fw={600}>
                          {Object.keys(backtestResults.finalPortfolio.positions || {}).length}
                        </Text>
                      </Grid.Col>
                      <Grid.Col span={6}>
                        <Text size="sm" c="dimmed">
                          Total P&L
                        </Text>
                        <Text fw={600} c={totalPnl >= 0 ? 'green' : 'red'}>
                          ${totalPnl.toFixed(2)}
                        </Text>
                      </Grid.Col>
                    </Grid>
                  </Stack>
                </Paper>
              )}
            </Stack>
          </div>
        ) : (
          <div
            style={{
              height: 400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px dashed var(--mantine-color-gray-6)',
              borderRadius: 'var(--mantine-radius-md)',
              color: 'var(--mantine-color-dimmed)',
            }}
          >
            <Text>Configure and run a backtest to see results</Text>
          </div>
        )}
      </Tabs.Panel>

      <Tabs.Panel value="chart" pt="md">
        {isLoadingChart ? (
          <Paper p="xl" withBorder>
            <Stack align="center" gap="md">
              <Text>Loading chart data...</Text>
            </Stack>
          </Paper>
        ) : (
          <div
            onClick={(e) => {
              // Clear highlight if clicking on the panel background
              if (e.target === e.currentTarget) {
                highlightTrade(null);
              }
            }}
          >
            <OrchestratorChart
              data={marketData}
              trades={chartTrades}
              equityCurve={equityCurve}
              chartMode="candles"
              showTrades={true}
              height={500}
              isFullscreen={isChartFullscreen}
              onToggleFullscreen={() => setIsChartFullscreen(!isChartFullscreen)}
            />
          </div>
        )}
      </Tabs.Panel>

      <Tabs.Panel value="trades" pt="md">
        <TradeHistory />
      </Tabs.Panel>

      <Tabs.Panel value="logs" pt="md">
        <Stack h="500px" gap="xs">
          <Group justify="space-between">
            <Group>
              <Text fw={600} size="sm">
                System Logs
              </Text>
              <Text size="xs" c="dimmed">
                ({logs.length} entries)
              </Text>
            </Group>
            <Button size="xs" variant="subtle" onClick={clearLogs}>
              Clear
            </Button>
          </Group>
          <ScrollArea h="100%" offsetScrollbars>
            <Stack gap={4}>
              {logs.map((log, index) => (
                <Group key={index} gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace', minWidth: 140 }}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </Text>
                  <Badge size="xs" color={getLogColor(log.level)} variant="dot">
                    {log.level}
                  </Badge>
                  <Text size="xs" c={getLogColor(log.level)} style={{ fontFamily: 'monospace' }}>
                    {log.message}
                  </Text>
                </Group>
              ))}
              {logs.length === 0 && (
                <Text size="xs" c="dimmed" ta="center">
                  No logs yet...
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}
