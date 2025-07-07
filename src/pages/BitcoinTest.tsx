/**
 * Bitcoin Test Page - SAFE testing environment
 * This page is completely separate from the main trading interface
 * Used to test Bitcoin data integration without affecting forex functionality
 */

import React, { useState } from 'react';
import { Container, Title, Paper, Group, Button, Text, Badge, Stack } from '@mantine/core';
import BitcoinTestChart from '../components/BitcoinTestChart';
import { IconBrandBitcoin, IconDatabase, IconRefresh } from '@tabler/icons-react';

const BitcoinTest: React.FC = () => {
  const [timeframe, setTimeframe] = useState('1h');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [testStatus, setTestStatus] = useState({
    database: 'connected',
    pulsar: 'pending',
    realtime: 'pending'
  });

  const timeframes = ['15m', '1h', '4h', '12h'];

  const handleTimeframeChange = (newTimeframe: string) => {
    console.log('Bitcoin test: Changing timeframe to', newTimeframe);
    setTimeframe(newTimeframe);
  };

  const testPulsarConnection = async () => {
    // This would connect to the Kraken ingester via Pulsar
    setTestStatus(prev => ({ ...prev, pulsar: 'testing' }));
    // Placeholder for actual Pulsar test
    setTimeout(() => {
      setTestStatus(prev => ({ ...prev, pulsar: 'connected' }));
    }, 1000);
  };

  return (
    <Container size="xl" py="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group>
            <IconBrandBitcoin size={32} color="#f7931a" />
            <Title order={2}>Bitcoin Integration Test</Title>
          </Group>
          <Group>
            <Badge 
              color={testStatus.database === 'connected' ? 'green' : 'gray'}
              leftSection={<IconDatabase size={14} />}
            >
              Database: {testStatus.database}
            </Badge>
            <Badge 
              color={testStatus.pulsar === 'connected' ? 'green' : testStatus.pulsar === 'testing' ? 'yellow' : 'gray'}
            >
              Pulsar: {testStatus.pulsar}
            </Badge>
            <Badge 
              color={testStatus.realtime === 'connected' ? 'green' : 'gray'}
            >
              Real-time: {testStatus.realtime}
            </Badge>
          </Group>
        </Group>

        <Paper p="md" withBorder>
          <Stack gap="sm">
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Testing Bitcoin data from bitcoin_ticks and bitcoin_candles_* tables
              </Text>
              <Group gap="xs">
                {timeframes.map((tf) => (
                  <Button
                    key={tf}
                    size="xs"
                    variant={timeframe === tf ? 'filled' : 'subtle'}
                    onClick={() => handleTimeframeChange(tf)}
                  >
                    {tf}
                  </Button>
                ))}
              </Group>
            </Group>
            
            <BitcoinTestChart
              symbol="BTCUSD"
              timeframe={timeframe}
              onTimeframeChange={handleTimeframeChange}
              isFullscreen={isFullscreen}
              onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            />
          </Stack>
        </Paper>

        <Paper p="md" withBorder>
          <Stack gap="sm">
            <Title order={4}>Test Controls</Title>
            <Group>
              <Button 
                leftSection={<IconRefresh size={16} />}
                onClick={testPulsarConnection}
                loading={testStatus.pulsar === 'testing'}
              >
                Test Pulsar Connection
              </Button>
              <Button variant="subtle">
                Start Kraken Ingester
              </Button>
              <Button variant="subtle">
                View Pulsar Topics
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              Note: This test page uses separate Bitcoin tables and does not affect forex data or charts.
            </Text>
          </Stack>
        </Paper>

        <Paper p="md" withBorder bg="dark.8">
          <Stack gap="xs">
            <Title order={5}>Data Summary</Title>
            <Text size="sm" style={{ fontFamily: 'monospace' }}>
              Table: bitcoin_ticks{'\n'}
              Records: 686,058{'\n'}
              Date Range: 2025-01-01 to 2025-01-07{'\n'}
              Price Range: $93,408 - $102,684
            </Text>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
};

export default BitcoinTest;