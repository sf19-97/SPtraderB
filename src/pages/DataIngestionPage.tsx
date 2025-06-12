// src/pages/DataIngestionPage.tsx
import { useState } from 'react';
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
  Code
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconDatabase, IconDownload } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';

const CURRENCY_PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 
  'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
];

export const DataIngestionPage = () => {
  const [selectedPair, setSelectedPair] = useState<string>('EURUSD');
  const [startDate, setStartDate] = useState<Date | null>(new Date('2024-01-01'));
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const [isIngesting, setIsIngesting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const startIngestion = async () => {
    if (!startDate || !endDate || !selectedPair) {
      setStatus({ type: 'error', message: 'Please fill all fields' });
      return;
    }

    setIsIngesting(true);
    setStatus(null);
    setLogs([`Starting ingestion for ${selectedPair}...`]);

    try {
      const result = await invoke<{ success: boolean; message: string }>('start_data_ingestion', {
        request: {
          symbol: selectedPair,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
        }
      });

      if (result.success) {
        setStatus({ type: 'success', message: 'Data ingestion completed successfully!' });
        setLogs(prev => [...prev, result.message]);
      } else {
        setStatus({ type: 'error', message: result.message });
      }
    } catch (error) {
      setStatus({ type: 'error', message: `Failed: ${error}` });
    } finally {
      setIsIngesting(false);
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
              onChange={setStartDate}
              placeholder="Pick start date"
              valueFormat="YYYY-MM-DD"
              styles={{
                input: { background: '#2a2a2a', border: '1px solid #444' }
              }}
            />

            <DatePickerInput
              label="End Date"
              value={endDate}
              onChange={setEndDate}
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

          <Button
            onClick={startIngestion}
            loading={isIngesting}
            leftSection={<IconDownload size={16} />}
            size="md"
            variant="gradient"
            gradient={{ from: 'indigo', to: 'cyan' }}
            disabled={!selectedPair || !startDate || !endDate}
          >
            {isIngesting ? 'Downloading...' : 'Start Download'}
          </Button>

          {isIngesting && (
            <Progress value={30} animated />
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

      {/* Add existing data summary */}
      <Paper p="xl" mt="xl" withBorder style={{ background: '#1a1a1a' }}>
        <Title order={3} c="white" mb="md">
          Available Data
        </Title>
        <Text c="dimmed">
          Check what data is already in your database
        </Text>
        {/* Add a table or list of available pairs and date ranges */}
      </Paper>
    </Container>
  );
};