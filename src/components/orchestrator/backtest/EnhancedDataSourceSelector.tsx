import { useState, useEffect } from 'react';
import { SegmentedControl, Select, Group, Text, Badge, Button, Stack, Paper } from '@mantine/core';
import { IconDatabase, IconFile, IconRefresh, IconCheck } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { useChartStore } from '../../../stores/useChartStore';
import { notifications } from '@mantine/notifications';

interface Props {
  dataSource: 'cache' | 'database' | 'parquet';
  onDataSourceChange: (source: 'cache' | 'database' | 'parquet') => void;
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  timeframe: string;
  onTimeframeChange: (timeframe: string) => void;
  parquetFile?: string;
  onParquetFileChange?: (file: string) => void;
  startDate: Date;
  endDate: Date;
}

export function EnhancedDataSourceSelector({
  dataSource,
  onDataSourceChange,
  symbol,
  onSymbolChange,
  timeframe,
  onTimeframeChange,
  parquetFile,
  onParquetFileChange,
  startDate,
  endDate,
}: Props) {
  const [availableDatasets, setAvailableDatasets] = useState<string[]>([]);
  const [isLoadingCache, setIsLoadingCache] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<'empty' | 'loading' | 'loaded'>('empty');

  const { getCachedCandles, setCachedCandles, getCacheKey, currentSymbol, currentTimeframe } =
    useChartStore();

  // Check cache status when params change
  useEffect(() => {
    if (dataSource === 'cache') {
      checkCacheStatus();
    }
  }, [symbol, timeframe, startDate, endDate, dataSource]);

  const checkCacheStatus = () => {
    if (!startDate || !endDate) return;

    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);

    const fromTimestamp = Math.floor(start.getTime() / 1000);
    const toTimestamp = Math.floor(end.getTime() / 1000);
    const cacheKey = getCacheKey(symbol, timeframe, fromTimestamp, toTimestamp);
    const cachedData = getCachedCandles(cacheKey);

    setCacheStatus(cachedData ? 'loaded' : 'empty');
  };

  const loadIntoCache = async () => {
    if (!startDate || !endDate) {
      notifications.show({
        title: 'Invalid Date Range',
        message: 'Please select start and end dates',
        color: 'red',
      });
      return;
    }

    setIsLoadingCache(true);
    setCacheStatus('loading');

    try {
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);

      const fromTimestamp = Math.floor(start.getTime() / 1000);
      const toTimestamp = Math.floor(end.getTime() / 1000);
      const cacheKey = getCacheKey(symbol, timeframe, fromTimestamp, toTimestamp);

      // Check if already cached
      const existing = getCachedCandles(cacheKey);
      if (existing) {
        notifications.show({
          title: 'Data Already Cached',
          message: `${symbol} ${timeframe} data is already in cache`,
          color: 'blue',
          icon: <IconCheck size={16} />,
        });
        setCacheStatus('loaded');
        setIsLoadingCache(false);
        return;
      }

      // Fetch from database
      const data = await invoke<any[]>('fetch_candles', {
        request: {
          symbol,
          timeframe,
          from: fromTimestamp,
          to: toTimestamp,
        },
      });

      if (data && data.length > 0) {
        // Cache the data
        setCachedCandles(cacheKey, data);
        setCacheStatus('loaded');

        notifications.show({
          title: 'Data Cached Successfully',
          message: `Loaded ${data.length} candles into cache`,
          color: 'green',
          icon: <IconCheck size={16} />,
        });
      } else {
        notifications.show({
          title: 'No Data Found',
          message: 'No data available for the selected range',
          color: 'orange',
        });
        setCacheStatus('empty');
      }
    } catch (error) {
      notifications.show({
        title: 'Failed to Load Data',
        message: String(error),
        color: 'red',
      });
      setCacheStatus('empty');
    } finally {
      setIsLoadingCache(false);
    }
  };

  // Load available parquet files
  useEffect(() => {
    if (dataSource === 'parquet') {
      loadAvailableDatasets();
    }
  }, [dataSource]);

  const loadAvailableDatasets = async () => {
    try {
      const datasets = await invoke<string[]>('list_test_datasets');
      setAvailableDatasets(datasets);
    } catch (error) {
      console.error('Failed to load datasets:', error);
    }
  };

  return (
    <Stack gap="sm">
      <Group grow>
        <SegmentedControl
          value={dataSource}
          onChange={(value) => onDataSourceChange(value as 'cache' | 'database' | 'parquet')}
          data={[
            { value: 'cache', label: 'Cache (Fast)' },
            { value: 'database', label: 'Database' },
            { value: 'parquet', label: 'Parquet File' },
          ]}
        />
      </Group>

      {/* Cache Mode */}
      {dataSource === 'cache' && (
        <Paper p="sm" withBorder>
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <Text size="sm" fw={500}>
                  Cache Status:
                </Text>
                <Badge
                  color={
                    cacheStatus === 'loaded' ? 'green' : cacheStatus === 'loading' ? 'blue' : 'gray'
                  }
                  variant="dot"
                >
                  {cacheStatus === 'loaded'
                    ? 'Data Cached'
                    : cacheStatus === 'loading'
                      ? 'Loading...'
                      : 'Empty'}
                </Badge>
              </Group>

              {cacheStatus !== 'loaded' && (
                <Button
                  size="xs"
                  leftSection={<IconRefresh size={14} />}
                  onClick={loadIntoCache}
                  loading={isLoadingCache}
                >
                  Load into Cache
                </Button>
              )}
            </Group>

            <Group grow>
              <Select
                label="Symbol"
                value={symbol}
                onChange={(value) => value && onSymbolChange(value)}
                data={['EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD']}
                leftSection={<IconDatabase size={16} />}
              />

              <Select
                label="Timeframe"
                value={timeframe}
                onChange={(value) => value && onTimeframeChange(value)}
                data={[
                  { value: '5m', label: '5 minutes' },
                  { value: '15m', label: '15 minutes' },
                  { value: '1h', label: '1 hour' },
                  { value: '4h', label: '4 hours' },
                  { value: '12h', label: '12 hours' },
                ]}
              />
            </Group>

            {cacheStatus === 'loaded' && (
              <Text size="xs" c="dimmed" ta="center">
                Using cached data for faster execution
              </Text>
            )}
          </Stack>
        </Paper>
      )}

      {/* Database Mode */}
      {dataSource === 'database' && (
        <Group grow>
          <Select
            label="Symbol"
            value={symbol}
            onChange={(value) => value && onSymbolChange(value)}
            data={['EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD']}
            leftSection={<IconDatabase size={16} />}
          />

          <Select
            label="Timeframe"
            value={timeframe}
            onChange={(value) => value && onTimeframeChange(value)}
            data={[
              { value: '5m', label: '5 minutes' },
              { value: '15m', label: '15 minutes' },
              { value: '1h', label: '1 hour' },
              { value: '4h', label: '4 hours' },
              { value: '12h', label: '12 hours' },
            ]}
          />
        </Group>
      )}

      {/* Parquet Mode */}
      {dataSource === 'parquet' && (
        <Stack gap="xs">
          <Group>
            <Select
              label="Dataset"
              placeholder="Select a parquet file"
              value={parquetFile}
              onChange={(value) => value && onParquetFileChange?.(value)}
              data={availableDatasets}
              leftSection={<IconFile size={16} />}
              style={{ flex: 1 }}
              searchable
            />
            <Button size="sm" variant="subtle" onClick={loadAvailableDatasets} mt="lg">
              <IconRefresh size={16} />
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
