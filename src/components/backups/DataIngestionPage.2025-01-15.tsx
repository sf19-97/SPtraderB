// src/pages/DataIngestionPage.tsx
import { useState, useEffect } from 'react';
import { 
  Container, 
  Title, 
  Paper, 
  Select, 
  Button, 
  Stack, 
  Alert, 
  Progress,
  Group,
  Text,
  Code,
  Table,
  Badge,
  ActionIcon,
  Box,
  Loader,
  Checkbox,
  Modal
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconDatabase, IconDownload, IconRefresh, IconTrash, IconX, IconChartCandle } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const CURRENCY_PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 
  'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
];

interface AvailableData {
  symbol: string;
  start_date: string;
  end_date: string;
  tick_count: number;
  candle_count_5m: number;
  candle_count_15m: number;
  candle_count_1h: number;
  candle_count_4h: number;
  candle_count_12h: number;
  last_updated: string;
  size_mb: number;
  candles_up_to_date: boolean;
  last_candle_refresh: string | null;
}

export const DataIngestionPage = () => {
  const [selectedPair, setSelectedPair] = useState<string>('EURUSD');
  const [startDate, setStartDate] = useState<Date | null>(new Date('2024-01-01'));
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const [isIngesting, setIsIngesting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [availableData, setAvailableData] = useState<AvailableData[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentIngestionSymbol, setCurrentIngestionSymbol] = useState<string | null>(null);
  const [refreshingSymbol, setRefreshingSymbol] = useState<string | null>(null);
  const [refreshProgress, setRefreshProgress] = useState<{ [key: string]: { progress: number; stage: string } }>({});
  const [autoGenerateCandles, setAutoGenerateCandles] = useState(true);
  
  // Modal states
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Fetch available data on component mount and listen for refresh progress
  useEffect(() => {
    fetchAvailableData();

    // Listen for candle refresh progress
    const unlistenRefresh = listen<{ symbol: string; progress: number; stage: string }>('candle-refresh-progress', (event) => {
      setRefreshProgress(prev => ({
        ...prev,
        [event.payload.symbol]: {
          progress: event.payload.progress,
          stage: event.payload.stage
        }
      }));
      
      // Clear progress after completion
      if (event.payload.progress === 100) {
        setTimeout(() => {
          setRefreshingSymbol(null);
          setRefreshProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[event.payload.symbol];
            return newProgress;
          });
          fetchAvailableData(); // Refresh data after candle generation
        }, 1000);
      }
    });

    // Listen for ingestion completion
    const unlistenCompleted = listen<string>('ingestion-completed', (event) => {
      console.log('[DataIngestionPage] Ingestion completed for:', event.payload);
      setIsIngesting(false);
      setCurrentIngestionSymbol(null);
      setStatus({
        type: 'success',
        message: `Successfully completed ingestion for ${event.payload}`
      });
      fetchAvailableData(); // Refresh the available data
      
      // Auto-generate candles if option is checked
      if (autoGenerateCandles) {
        // Refresh data and then generate candles
        setTimeout(() => {
          fetchAvailableData();
        }, 1000);
      }
    });

    // Listen for ingestion failure
    const unlistenFailed = listen<string>('ingestion-failed', (event) => {
      console.log('[DataIngestionPage] Ingestion failed for:', event.payload);
      setIsIngesting(false);
      setCurrentIngestionSymbol(null);
      setStatus({
        type: 'error',
        message: `Ingestion failed for ${event.payload}`
      });
    });

    // Listen for ingestion started
    const unlistenStarted = listen<string>('ingestion-started', (event) => {
      console.log('[DataIngestionPage] Ingestion started for:', event.payload);
      setCurrentIngestionSymbol(event.payload);
    });

    return () => {
      unlistenRefresh.then(fn => fn());
      unlistenCompleted.then(fn => fn());
      unlistenFailed.then(fn => fn());
      unlistenStarted.then(fn => fn());
    };
  }, [autoGenerateCandles]);

  const fetchAvailableData = async () => {
    setIsLoadingData(true);
    try {
      const data = await invoke<AvailableData[]>('get_available_data');
      setAvailableData(data);
    } catch (error) {
      console.error('Failed to fetch available data:', error);
      setStatus({ type: 'error', message: `Failed to fetch data: ${error}` });
    } finally {
      setIsLoadingData(false);
    }
  };

  const deleteDataRange = async (symbol: string) => {
    setConfirmModal({
      open: true,
      title: 'Delete Data',
      message: `Are you sure you want to delete all data for ${symbol}? This action cannot be undone.`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
        
        try {
          const success = await invoke<boolean>('delete_data_range', {
            request: { symbol }
          });
          
          if (success) {
            setStatus({ type: 'success', message: `Successfully deleted data for ${symbol}` });
            // Refresh the data list
            await fetchAvailableData();
          }
        } catch (error) {
          setStatus({ type: 'error', message: `Failed to delete data: ${error}` });
        }
      }
    });
  };

  const generateCandles = async (data: AvailableData) => {
    console.log('[DataIngestionPage] generateCandles called for:', data.symbol);
    console.log('[DataIngestionPage] Data object:', data);
    
    const message = data.candles_up_to_date 
      ? `Candles appear to be up-to-date for ${data.symbol}. Generate anyway?`
      : `Generate missing candles for ${data.symbol}? This will process new data since the last refresh.`;
    
    setConfirmModal({
      open: true,
      title: 'Generate Candles',
      message: message,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
        
        console.log('[DataIngestionPage] Starting candle generation for', data.symbol);
        setRefreshingSymbol(data.symbol);
        setStatus({ type: 'success', message: `Generating candles for ${data.symbol}...` });

        try {
          console.log('[DataIngestionPage] Invoking refresh_candles with:', {
            symbol: data.symbol,
            start_date: data.start_date,
            end_date: data.end_date,
          });
          
          const success = await invoke<boolean>('refresh_candles', {
            request: {
              symbol: data.symbol,
              start_date: data.start_date,
              end_date: data.end_date,
            }
          });
          
          console.log('[DataIngestionPage] refresh_candles returned:', success);
          
          if (success) {
            setStatus({ type: 'success', message: `Successfully generated candles for ${data.symbol}` });
            // Refresh the data list to show updated candle counts
            await fetchAvailableData();
          }
        } catch (error) {
          console.error('[DataIngestionPage] refresh_candles error:', error);
          setStatus({ type: 'error', message: `Failed to generate candles: ${error}` });
          setRefreshingSymbol(null);
        }
      }
    });
  };

  const cancelIngestion = async () => {
    if (!currentIngestionSymbol) return;
    
    try {
      const cancelled = await invoke<boolean>('cancel_ingestion', { symbol: currentIngestionSymbol });
      if (cancelled) {
        setStatus({ type: 'success', message: `Cancelled ingestion for ${currentIngestionSymbol}` });
        setLogs(prev => [...prev, `Ingestion cancelled for ${currentIngestionSymbol}`]);
        setIsIngesting(false);
        setCurrentIngestionSymbol(null);
        setProgress(0);
      }
    } catch (error) {
      setStatus({ type: 'error', message: `Failed to cancel: ${error}` });
    }
  };

  const startIngestion = async () => {
    if (!startDate || !endDate || !selectedPair) {
      setStatus({ type: 'error', message: 'Please fill all fields' });
      return;
    }

    setIsIngesting(true);
    setStatus(null);
    setProgress(0);
    setCurrentIngestionSymbol(selectedPair);
    setLogs([`Starting ingestion for ${selectedPair}...`]);

    try {
      const result = await invoke<{ success: boolean; message: string }>('start_data_ingestion', {
        request: {
          symbol: selectedPair,
          start_date: startDate!.toISOString().split('T')[0],
          end_date: endDate!.toISOString().split('T')[0],
        }
      });

      if (result.success) {
        setLogs(prev => [...prev, result.message]);
        // The process is now running in background
        // We'll handle completion via events
        
        // If auto-generate is enabled, wait for completion then generate candles
        if (autoGenerateCandles) {
          // TODO: Listen for ingestion completion event and trigger candle generation
          setLogs(prev => [...prev, 'Auto-generate candles enabled - will generate after download completes']);
        }
      } else {
        setStatus({ type: 'error', message: result.message });
        setIsIngesting(false);
        setCurrentIngestionSymbol(null);
      }
    } catch (error) {
      setStatus({ type: 'error', message: `Failed: ${error}` });
      setIsIngesting(false);
      setCurrentIngestionSymbol(null);
    }
  };

  return (
    <Container size="md" pt="xl" style={{ minHeight: '100vh', background: '#0a0a0a' }}>
      <Title order={1} c="white" mb="xl">
        Data Ingestion Manager
      </Title>

      <Paper p="xl" withBorder style={{ background: '#1a1a1a' }}>
        <Stack>
          <Title order={3} c="white">
            Download Historical Data
          </Title>
          
          <Text c="dimmed" size="sm">
            Download tick data from Dukascopy for backtesting
          </Text>

          <Select
            label="Currency Pair"
            value={selectedPair}
            onChange={(value) => value && setSelectedPair(value)}
            data={CURRENCY_PAIRS}
            leftSection={<IconDatabase size={16} />}
            styles={{
              input: { background: '#2a2a2a', border: '1px solid #444' }
            }}
          />

          <Group grow>
            <DatePickerInput
              label="Start Date"
              value={startDate}
              onChange={(value: string | null) => {
                if (value) {
                  // Add 'T12:00:00Z' to ensure it's parsed as noon UTC, avoiding timezone issues
                  const date = new Date(value + 'T12:00:00Z');
                  setStartDate(date);
                } else {
                  setStartDate(null);
                }
              }}
              placeholder="Pick start date"
              valueFormat="YYYY-MM-DD"
              styles={{
                input: { background: '#2a2a2a', border: '1px solid #444' }
              }}
            />

            <DatePickerInput
              label="End Date"
              value={endDate}
              onChange={(value: string | null) => {
                if (value) {
                  // Add 'T12:00:00Z' to ensure it's parsed as noon UTC, avoiding timezone issues
                  const date = new Date(value + 'T12:00:00Z');
                  setEndDate(date);
                } else {
                  setEndDate(null);
                }
              }}
              placeholder="Pick end date"
              valueFormat="YYYY-MM-DD"
              styles={{
                input: { background: '#2a2a2a', border: '1px solid #444' }
              }}
            />
          </Group>

          {status && (
            <Alert color={status.type === 'success' ? 'green' : 'red'}>
              {status.message}
            </Alert>
          )}

          <Stack gap="md">
            <Checkbox
              label="Auto-generate candles after download"
              checked={autoGenerateCandles}
              onChange={(event) => setAutoGenerateCandles(event.currentTarget.checked)}
              styles={{
                label: { color: 'white' }
              }}
            />
            
            <Group>
              <Button
                onClick={startIngestion}
                loading={isIngesting}
                leftSection={<IconDownload size={16} />}
                size="md"
                variant="gradient"
                gradient={{ from: 'indigo', to: 'cyan' }}
                disabled={!selectedPair || !startDate || !endDate || isIngesting}
              >
                {isIngesting ? 'Downloading...' : 'Start Download'}
              </Button>
              
              {isIngesting && (
                <Button
                  onClick={cancelIngestion}
                  leftSection={<IconX size={16} />}
                  size="md"
                  color="red"
                  variant="outline"
                >
                  Cancel
                </Button>
              )}
            </Group>
          </Stack>

          {isIngesting && (
            <Box>
              <Progress 
                value={progress} 
                animated 
                size="lg"
                styles={{
                  root: { background: '#1a1a1a' }
                }}
              />
              <Text size="xs" c="dimmed" mt="xs" ta="center">
                {progress.toFixed(0)}% Complete
              </Text>
            </Box>
          )}

          {logs.length > 0 && (
            <Paper p="md" style={{ background: '#0a0a0a' }}>
              <Text size="sm" c="dimmed" mb="xs">Logs:</Text>
              <Code block style={{ background: '#000', color: '#0f0' }}>
                {logs.join('\n')}
              </Code>
            </Paper>
          )}
        </Stack>
      </Paper>

      {/* Available Data Section */}
      <Paper p="xl" mt="xl" withBorder style={{ background: '#1a1a1a' }}>
        <Group justify="space-between" mb="md">
          <div>
            <Title order={3} c="white">
              Available Data
            </Title>
            <Text c="dimmed" size="sm">
              Historical data currently in your database
            </Text>
          </div>
          <ActionIcon
            onClick={fetchAvailableData}
            loading={isLoadingData}
            variant="subtle"
            color="cyan"
            size="lg"
          >
            <IconRefresh size={20} />
          </ActionIcon>
        </Group>

        {isLoadingData ? (
          <Box style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
            <Loader color="cyan" />
          </Box>
        ) : availableData.length === 0 ? (
          <Text c="dimmed" ta="center" p="xl">
            No data available. Start by downloading some historical data above.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Pair</Table.Th>
                <Table.Th>Date Range</Table.Th>
                <Table.Th>Ticks</Table.Th>
                <Table.Th>Candles</Table.Th>
                <Table.Th>Size</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {availableData.map((data) => (
                <Table.Tr key={data.symbol}>
                  <Table.Td>
                    <Badge
                      size="lg"
                      variant="light"
                      styles={{
                        root: { 
                          background: 'rgba(0, 255, 136, 0.1)',
                          border: '1px solid rgba(0, 255, 136, 0.3)',
                        }
                      }}
                    >
                      {data.symbol}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {data.start_date} → {data.end_date}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{data.tick_count.toLocaleString()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{(data.candle_count_5m + data.candle_count_15m + data.candle_count_1h + data.candle_count_4h + data.candle_count_12h).toLocaleString()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{data.size_mb.toFixed(1)} MB</Text>
                  </Table.Td>
                  <Table.Td>
                    {refreshProgress[data.symbol] ? (
                      <Stack gap={4}>
                        <Progress 
                          value={refreshProgress[data.symbol].progress} 
                          size="xs" 
                          color="cyan"
                          animated
                        />
                        <Text size="xs" c="dimmed">{refreshProgress[data.symbol].stage}</Text>
                      </Stack>
                    ) : (
                      <Group gap="xs">
                        <Box
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: data.candles_up_to_date ? '#00ff88' : '#ff9900',
                            animation: data.candles_up_to_date ? 'pulse 2s infinite' : 'none',
                          }}
                        />
                        <Text size="sm" c={data.candles_up_to_date ? 'green' : 'orange'}>
                          {data.candles_up_to_date ? 'Ready' : 'Needs refresh'}
                        </Text>
                      </Group>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <ActionIcon
                        variant="subtle"
                        color={data.candles_up_to_date ? "gray" : "cyan"}
                        size="sm"
                        onClick={() => generateCandles(data)}
                        title={data.candles_up_to_date ? "Candles up-to-date" : "Generate missing candles"}
                        disabled={refreshingSymbol !== null}
                        loading={refreshingSymbol === data.symbol}
                      >
                        <IconChartCandle size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        onClick={() => deleteDataRange(data.symbol)}
                        title="Delete data"
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
      
      {/* Add pulse animation */}
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `}
      </style>
      
      {/* Confirmation Modal */}
      <Modal
        opened={confirmModal.open}
        onClose={() => setConfirmModal(prev => ({ ...prev, open: false }))}
        title={confirmModal.title}
        centered
        styles={{
          title: { fontSize: '18px', fontWeight: 600 },
          body: { padding: '20px' }
        }}
      >
        <Stack>
          <Text>{confirmModal.message}</Text>
          <Group justify="flex-end" mt="xl">
            <Button
              variant="default"
              onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))}
            >
              Cancel
            </Button>
            <Button
              color="blue"
              onClick={confirmModal.onConfirm}
            >
              Confirm
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};