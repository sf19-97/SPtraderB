import { useState, useEffect, useMemo } from 'react';
import { Stack, Radio, Select, Group, Text, Loader } from '@mantine/core';
import { IconDatabase, IconFile } from '@tabler/icons-react';
import { useTradingStore } from '../../../stores/useTradingStore';

interface DataSourceSelectorProps {
  dataSource: 'database' | 'parquet';
  onDataSourceChange: (value: 'database' | 'parquet') => void;
  symbol?: string;
  onSymbolChange: (value: string) => void;
  timeframe?: string;
  onTimeframeChange: (value: string) => void;
  parquetFile?: string;
  onParquetFileChange: (value: string) => void;
}

export function DataSourceSelector({
  dataSource,
  onDataSourceChange,
  symbol,
  onSymbolChange,
  timeframe,
  onTimeframeChange,
  parquetFile,
  onParquetFileChange,
}: DataSourceSelectorProps) {
  const { catalog, fetchCatalog } = useTradingStore();
  const [datasets, setDatasets] = useState<string[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(false);

  // Fetch catalog on mount
  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  // Load available parquet files when component mounts or data source changes
  useEffect(() => {
    if (dataSource === 'parquet') {
      loadDatasets();
    }
  }, [dataSource]);

  const loadDatasets = async () => {
    setLoadingDatasets(true);
    try {
      // Parquet files are not supported in web-only mode
      // TODO: Add support for uploading/managing datasets via API
      setDatasets([]);
    } catch (err) {
      console.error('Failed to load datasets:', err);
      setDatasets([]);
    } finally {
      setLoadingDatasets(false);
    }
  };

  // Format symbols and timeframes from catalog
  const symbols = useMemo(() => {
    return catalog.symbols.map((s) => ({
      value: s.symbol,
      label: s.symbol.replace(/([A-Z]{3})([A-Z]{3})/, '$1/$2'), // EURUSD -> EUR/USD
    }));
  }, [catalog.symbols]);

  const timeframes = useMemo(() => {
    return catalog.timeframes.map((tf) => ({ value: tf, label: tf }));
  }, [catalog.timeframes]);

  return (
    <Stack gap="md">
      <Radio.Group
        label="Data Source"
        value={dataSource}
        onChange={(value) => onDataSourceChange(value as 'database' | 'parquet')}
      >
        <Group mt="xs">
          <Radio
            value="database"
            label={
              <Group gap="xs">
                <IconDatabase size={16} />
                <Text>Database</Text>
              </Group>
            }
          />
          <Radio
            value="parquet"
            label={
              <Group gap="xs">
                <IconFile size={16} />
                <Text>Parquet File</Text>
              </Group>
            }
          />
        </Group>
      </Radio.Group>

      {dataSource === 'database' ? (
        <>
          <Select
            label="Symbol"
            placeholder={catalog.loading ? 'Loading symbols...' : 'Select a symbol'}
            value={symbol}
            onChange={(value) => onSymbolChange(value || '')}
            data={symbols}
            disabled={catalog.loading}
            rightSection={catalog.loading ? <Loader size="xs" /> : null}
            searchable
            required
          />

          <Select
            label="Timeframe"
            placeholder={catalog.loading ? 'Loading timeframes...' : 'Select a timeframe'}
            value={timeframe}
            onChange={(value) => onTimeframeChange(value || '')}
            data={timeframes}
            disabled={catalog.loading}
            rightSection={catalog.loading ? <Loader size="xs" /> : null}
            required
          />
        </>
      ) : (
        <Select
          label="Dataset"
          placeholder={loadingDatasets ? 'Loading datasets...' : 'Select a parquet file'}
          value={parquetFile}
          onChange={(value) => onParquetFileChange(value || '')}
          data={datasets}
          disabled={loadingDatasets}
          rightSection={loadingDatasets ? <Loader size="xs" /> : null}
          nothingFoundMessage="No datasets found in /workspace/data/"
          required
        />
      )}
    </Stack>
  );
}
