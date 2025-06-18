// src/pages/DataIngestionPage.tsx
import { useState, useEffect } from 'react';
import { 
  Title, 
  Paper, 
  Select, 
  Button, 
  Stack, 
  Progress,
  Group,
  Text,
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
import { TerminalLogger, LogEntry } from '../components/TerminalLogger';

// Default currency pairs - will be updated with actual available pairs
const DEFAULT_CURRENCY_PAIRS = [
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
  const [availableData, setAvailableData] = useState<AvailableData[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentIngestionSymbol, setCurrentIngestionSymbol] = useState<string | null>(null);
  const [refreshingSymbol, setRefreshingSymbol] = useState<string | null>(null);
  const [refreshProgress, setRefreshProgress] = useState<{ [key: string]: { progress: number; stage: string } }>({});
  const [autoGenerateCandles, setAutoGenerateCandles] = useState(true);
  const [availablePairs, setAvailablePairs] = useState<string[]>(DEFAULT_CURRENCY_PAIRS);
  
  // Terminal logs state
  const [terminalLogs, setTerminalLogs] = useState<LogEntry[]>([
    {
      id: 1,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, -5),
      type: 'info',
      prefix: '[INFO]',
      message: 'Data Ingestion Manager initialized',
      color: ''
    },
    {
      id: 2,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, -5),
      type: 'db',
      prefix: '[DB]',
      message: 'Connected to PostgreSQL database',
      color: ''
    },
    {
      id: 3,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, -5),
      type: 'success',
      prefix: '[SUCCESS]',
      message: 'Database connection pool established (10 connections)',
      color: ''
    }
  ]);
  
  // Add log helper function with debouncing for rapid updates
  const addLog = (type: LogEntry['type'], message: string, prefix?: string) => {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, -5);
    setTerminalLogs(prev => {
      const newLog: LogEntry = {
        id: Date.now() + Math.random(),
        timestamp,
        type,
        prefix: prefix || '',
        message,
        color: ''
      };
      // Keep only last 1000 logs
      const newLogs = [...prev, newLog];
      return newLogs.length > 1000 ? newLogs.slice(-1000) : newLogs;
    });
  };
  
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

  // Add test logs for Phase 2 testing
  const addTestLogs = () => {
    // Simulate various log types
    addLog('info', 'Test: Starting simulated process');
    setTimeout(() => addLog('python', 'Downloading EURUSD: 0%|          | 0/172 [00:00<?, ?it/s]'), 500);
    setTimeout(() => addLog('db', 'Executing bulk insert: 3,847 rows'), 1000);
    setTimeout(() => addLog('python', 'Downloading EURUSD: 10%|█         | 17/172 [00:30<05:26, 2.10s/it]'), 1500);
    setTimeout(() => addLog('debug', 'DEBUG: Raw bi5 header: 0x1F8B0800...'), 2000);
    setTimeout(() => addLog('perf', 'Memory usage: 342 MB / 1024 MB'), 2500);
    setTimeout(() => addLog('success', 'Successfully downloaded 2024-01-01 data'), 3000);
    setTimeout(() => addLog('warn', 'Rate limit approaching, slowing down requests'), 3500);
    setTimeout(() => addLog('error', 'HTTP 404: No data for 2024-01-02 (weekend)'), 4000);
    setTimeout(() => addLog('candles', 'Processing 5 minute candles... (20% complete)'), 4500);
    setTimeout(() => addLog('python', 'Downloading EURUSD: 20%|██        | 34/172 [01:00<04:00, 1.74s/it]'), 5000);
    
    // Test FIFO limit - generate many logs rapidly
    setTimeout(() => {
      addLog('info', 'Testing FIFO limit - generating 50 logs rapidly...');
      for (let i = 1; i <= 50; i++) {
        setTimeout(() => {
          addLog('debug', `DEBUG: Test log ${i} of 50 - checking FIFO behavior`);
          if (i === 50) {
            addLog('success', 'FIFO test complete - check if oldest logs were removed');
          }
        }, i * 50); // Stagger by 50ms each
      }
    }, 6000);
  };

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
      addLog('success', `Successfully completed ingestion for ${event.payload}`);
      
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
      addLog('error', `Ingestion failed for ${event.payload}`);
      
    });

    // Listen for ingestion started
    const unlistenStarted = listen<string>('ingestion-started', (event) => {
      console.log('[DataIngestionPage] Ingestion started for:', event.payload);
      setCurrentIngestionSymbol(event.payload);
      addLog('info', `Process spawned successfully for ${event.payload}`);
    });

    // Listen for progress updates
    const unlistenProgress = listen<{ symbol: string; progress: number }>('ingestion-progress', (event) => {
      setProgress(event.payload.progress);
      // Log progress updates every 10%
      if (event.payload.progress % 10 === 0) {
        addLog('info', `Download progress: ${event.payload.progress}% complete`);
      }
    });

    // Listen for backend logs
    const unlistenBackendLog = listen<{ timestamp: string; level: string; message: string }>('backend-log', (event) => {
      // Map backend log levels to our log types
      const levelMap: { [key: string]: LogEntry['type'] } = {
        'INFO': 'info',
        'SUCCESS': 'success',
        'WARN': 'warn',
        'ERROR': 'error',
        'DEBUG': 'debug',
        'PYTHON': 'python',
        'DB': 'db',
        'CANDLES': 'candles',
        'PERF': 'perf',
      };
      
      const logType = levelMap[event.payload.level] || 'info';
      addLog(logType, event.payload.message);
    });

    return () => {
      unlistenRefresh.then(fn => fn());
      unlistenCompleted.then(fn => fn());
      unlistenFailed.then(fn => fn());
      unlistenStarted.then(fn => fn());
      unlistenProgress.then(fn => fn());
      unlistenBackendLog.then(fn => fn());
    };
  }, [autoGenerateCandles]);

  const fetchAvailableData = async () => {
    setIsLoadingData(true);
    try {
      const data = await invoke<AvailableData[]>('get_available_data');
      setAvailableData(data);
      
      // Extract unique symbols from available data
      const uniqueSymbols = [...new Set(data.map(d => d.symbol))];
      
      // Combine with default pairs and keep unique
      const allPairs = [...new Set([...uniqueSymbols, ...DEFAULT_CURRENCY_PAIRS])];
      setAvailablePairs(allPairs.sort());
      
      addLog('info', `Loaded ${data.length} currency pairs from database`);
    } catch (error) {
      console.error('Failed to fetch available data:', error);
      addLog('error', `Failed to fetch available data: ${error}`);
      
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
            addLog('success', `Successfully deleted all data for ${symbol}`);
            // Refresh the data list
            await fetchAvailableData();
          }
        } catch (error) {
          addLog('error', `Failed to delete data: ${error}`);
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
        addLog('user', `Candle generation triggered manually`);
        addLog('candles', `Starting smart refresh for ${data.symbol}`);

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
            addLog('success', `Successfully generated all candles for ${data.symbol}`);
            // Refresh the data list to show updated candle counts
            await fetchAvailableData();
          }
        } catch (error) {
          console.error('[DataIngestionPage] refresh_candles error:', error);
          addLog('error', `Failed to generate candles: ${error}`);
          setRefreshingSymbol(null);
        }
      }
    });
  };

  const cancelIngestion = async () => {
    if (!currentIngestionSymbol) return;
    
    addLog('user', 'Download cancelled by user');
    
    try {
      const cancelled = await invoke<boolean>('cancel_ingestion', { symbol: currentIngestionSymbol });
      if (cancelled) {
        addLog('warn', `Process terminated for ${currentIngestionSymbol}`);
        addLog('success', `Cancelled ingestion for ${currentIngestionSymbol}`);
        setIsIngesting(false);
        setCurrentIngestionSymbol(null);
        setProgress(0);
      }
    } catch (error) {
      addLog('error', `Failed to cancel: ${error}`);
    }
  };

  const startIngestion = async () => {
    if (!startDate || !endDate || !selectedPair) {
      addLog('error', 'Please fill all fields before starting download');
      return;
    }

    setIsIngesting(true);
    setProgress(0);
    setCurrentIngestionSymbol(selectedPair);
    addLog('user', `Download started by user`);
    addLog('info', `Starting ingestion for ${selectedPair} from ${startDate!.toISOString().split('T')[0]} to ${endDate!.toISOString().split('T')[0]}`);

    try {
      const result = await invoke<{ success: boolean; message: string }>('start_data_ingestion', {
        request: {
          symbol: selectedPair,
          start_date: startDate!.toISOString().split('T')[0],
          end_date: endDate!.toISOString().split('T')[0],
        }
      });

      if (result.success) {
        addLog('success', result.message);
        // The process is now running in background
        // We'll handle completion via events
        
        // If auto-generate is enabled, wait for completion then generate candles
        if (autoGenerateCandles) {
          // TODO: Listen for ingestion completion event and trigger candle generation
          addLog('info', 'Auto-generate candles enabled - will generate after download completes');
        }
      } else {
        addLog('error', result.message);
        setIsIngesting(false);
        setCurrentIngestionSymbol(null);
      }
    } catch (error) {
      addLog('error', `Failed: ${error}`);
      setIsIngesting(false);
      setCurrentIngestionSymbol(null);
    }
  };

  return (
    <Box style={{ display: 'flex', height: '100vh', background: '#0a0a0a' }}>
      {/* Left Panel - Main Content (60%) */}
      <Box style={{ flex: '0 0 60%', overflowY: 'auto', padding: '2rem' }}>
        <Group justify="space-between" mb="xl">
          <Title order={1} c="white">
            Data Ingestion Manager
          </Title>
          {/* Temporary test button - remove after Phase 2 testing */}
          <Button size="xs" variant="subtle" onClick={addTestLogs}>
            Test Logs
          </Button>
        </Group>

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
            data={availablePairs}
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

          {/* Status alerts now go to terminal logger
          {status && (
            <Alert color={status.type === 'success' ? 'green' : 'red'}>
              {status.message}
            </Alert>
          )} */}

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

          {/* Progress now shown in terminal logger
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
          )} */}

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
      </Box>

      {/* Right Panel - Terminal Logger (40%) */}
      <Box style={{ flex: '0 0 40%' }}>
        <TerminalLogger 
          logs={terminalLogs} 
          onClearLogs={() => {
            setTerminalLogs([{
              id: Date.now(),
              timestamp: new Date().toISOString().replace('T', ' ').slice(0, -5),
              type: 'info',
              prefix: '[INFO]',
              message: 'Console cleared',
              color: ''
            }]);
          }}
          isProcessRunning={isIngesting || refreshingSymbol !== null}
        />
      </Box>
    </Box>
  );
};