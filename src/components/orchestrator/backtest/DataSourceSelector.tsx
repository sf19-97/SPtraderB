import { useState, useEffect } from 'react';
import { Stack, Radio, Select, Group, Text, Loader } from '@mantine/core';
import { IconDatabase, IconFile } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';

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
  const [datasets, setDatasets] = useState<string[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(false);

  // Load available parquet files when component mounts or data source changes
  useEffect(() => {
    if (dataSource === 'parquet') {
      loadDatasets();
    }
  }, [dataSource]);

  const loadDatasets = async () => {
    setLoadingDatasets(true);
    try {
      const files = await invoke<string[]>('list_test_datasets');
      setDatasets(files);
    } catch (err) {
      console.error('Failed to load datasets:', err);
      setDatasets([]);
    } finally {
      setLoadingDatasets(false);
    }
  };

  const symbols = ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCAD', 'AUDUSD'];
  const timeframes = ['5m', '15m', '1h', '4h', '12h'];

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
            placeholder="Select a symbol"
            value={symbol}
            onChange={(value) => onSymbolChange(value || '')}
            data={symbols}
            required
          />
          
          <Select
            label="Timeframe"
            placeholder="Select a timeframe"
            value={timeframe}
            onChange={(value) => onTimeframeChange(value || '')}
            data={timeframes}
            required
          />
        </>
      ) : (
        <Select
          label="Dataset"
          placeholder={loadingDatasets ? "Loading datasets..." : "Select a parquet file"}
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