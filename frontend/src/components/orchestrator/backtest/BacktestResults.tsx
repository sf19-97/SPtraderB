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
import { useState, useMemo, useEffect, useRef } from 'react';
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
  const marketDataCache = useRef<Map<string, any>>(new Map());

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
    if (!backtestResults?.completed_trades) return [];

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
      side: trade.side === 'long' ? ('long' as const) : ('short' as const),
      pnl: typeof trade.pnl === 'string' ? parseFloat(trade.pnl) : trade.pnl,
      pnlPercent:
        typeof trade.pnl_percent === 'string' ? parseFloat(trade.pnl_percent) : trade.pnl_percent,
      exitReason: trade.exit_reason,
      holdingPeriod: trade.holding_period_hours,
    }));
  }, [backtestResults?.completed_trades]);

  // Generate equity curve data
  const equityCurve = useMemo(() => {
    // Backend returns daily_returns as tuple [timestamp, value]; value is Decimal (string or number)
    if (backtestResults?.daily_returns && backtestResults.daily_returns.length > 0) {
      const timestamps: string[] = [];
      const values: number[] = [];
      let currentValue = startCapital;

      // Add starting point
      const firstTs = backtestResults.daily_returns[0][0];
      timestamps.push(typeof firstTs === 'string' ? firstTs : new Date(firstTs).toISOString());
      values.push(startCapital);

      for (const [ts, v] of backtestResults.daily_returns as any) {
        const returnValue = typeof v === 'string' ? parseFloat(v) : v;
        currentValue = currentValue * (1 + returnValue);
        const timestamp =
          typeof ts === 'string' ? ts : new Date(ts).toISOString();
        timestamps.push(timestamp);
        values.push(currentValue);
      }

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

  // Load market data when chart tab is selected (cached per request)
  useEffect(() => {
    if (activeResultsTab !== 'chart') return;
    if (!backtestConfig || !backtestResults) return;
    loadMarketData();
  }, [activeResultsTab, backtestResults]);

  // Clear highlight when switching away from chart/trades tabs
  useEffect(() => {
    if (activeResultsTab !== 'chart' && activeResultsTab !== 'trades') {
      highlightTrade(null);
    }
  }, [activeResultsTab, highlightTrade]);

  const loadMarketData = async () => {
    const fromTimestamp = Math.floor(new Date(backtestConfig.startDate).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(backtestConfig.endDate).getTime() / 1000);
    const cacheKey = `${backtestConfig.symbol}-${backtestConfig.timeframe}-${fromTimestamp}-${toTimestamp}`;

    if (marketDataCache.current.has(cacheKey)) {
      setMarketData(marketDataCache.current.get(cacheKey));
      return;
    }

    setIsLoadingChart(true);

    try {
      // Fetch candle data from market data API
      const fromTimestamp = Math.floor(new Date(backtestConfig.startDate).getTime() / 1000);
      const toTimestamp = Math.floor(new Date(backtestConfig.endDate).getTime() / 1000);

      const marketDataUrl = import.meta.env.VITE_MARKET_DATA_API_URL || 'https://ws-market-data-server.fly.dev';
      const url = `${marketDataUrl}/api/candles?symbol=${backtestConfig.symbol}&timeframe=${backtestConfig.timeframe}&from=${fromTimestamp}&to=${toTimestamp}`;

      console.log('[BacktestResults] Fetching candles from:', url);

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch candles: HTTP ${response.status}`);
      }

      const candles = await response.json();

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

        // Backend currently returns signals as a count; no plotting available yet

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
    <Tabs
      value={activeResultsTab}
      onChange={(value) => value && setActiveResultsTab(value)}
      keepMounted
    >
      <Tabs.List>
        <Tabs.Tab value="overview" leftSection={<IconChartBar size={16} />}>
          Overview
        </Tabs.Tab>
        <Tabs.Tab value="chart" leftSection={<IconChartCandle size={16} />}>
          Chart
        </Tabs.Tab>
        <Tabs.Tab value="equity" leftSection={<IconChartLine size={16} />}>
          Equity Curve
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
            showModeToggle={false}
          />
        </div>
      )}
    </Tabs.Panel>

    <Tabs.Panel value="equity" pt="md">
      {equityCurve && equityCurve.timestamps.length > 0 ? (
        <OrchestratorChart
          chartMode="equity"
          equityCurve={equityCurve}
          showTrades={false}
          height={400}
          showModeToggle={false}
        />
      ) : (
          <Paper p="xl" withBorder>
            <Stack align="center" gap="md">
              <Text c="dimmed">Run a backtest to see the equity curve</Text>
            </Stack>
          </Paper>
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
