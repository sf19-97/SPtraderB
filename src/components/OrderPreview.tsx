import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Box, 
  Text, 
  Button, 
  Select, 
  Group, 
  Stack, 
  Paper, 
  Badge,
  Divider,
  ActionIcon
} from '@mantine/core';
import { 
  IconPlayerPlay, 
  IconBolt, 
  IconCircleCheck, 
  IconAlertCircle, 
  IconClock, 
  IconWifiOff, 
  IconWifi,
  IconRefresh, 
  IconActivity, 
  IconSend, 
  IconX, 
  IconChevronDown,
  IconSettings
} from '@tabler/icons-react';
import { useBrokerStore } from '../stores/useBrokerStore';

interface TestResults {
  type: string;
  executionTime: number;
  slippage: string;
  status: string;
  timestamp: string;
}

export const OrderPreview = () => {
  const navigate = useNavigate();
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'complete'>('idle');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected'>('connected');
  const [testResults, setTestResults] = useState<TestResults | null>(null);
  const [currentLatency, setCurrentLatency] = useState(12);
  const { profiles, activeProfileId, activateProfile } = useBrokerStore();
  
  // Get active profile
  const activeProfile = profiles.find(p => p.id === activeProfileId);

  // Simulate latency fluctuation
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentLatency(Math.floor(Math.random() * 20) + 8);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const runTest = (type: string) => {
    setTestStatus('running');
    setTestResults(null);
    
    setTimeout(() => {
      setTestStatus('complete');
      setTestResults({
        type: type,
        executionTime: Math.floor(Math.random() * 50) + 30,
        slippage: (Math.random() * 0.8 - 0.1).toFixed(1),
        status: Math.random() > 0.1 ? 'FILLED' : 'REJECTED',
        timestamp: new Date().toLocaleTimeString()
      });
    }, 1500);
  };

  const latencyColor = currentLatency < 20 ? '#40c057' : currentLatency < 50 ? '#fab005' : '#fa5252';
  const connectionColor = connectionStatus === 'connected' ? '#40c057' : '#fa5252';

  return (
    <Box style={{ 
      width: '400px', 
      background: '#252526', 
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <Box style={{ 
        background: '#1a1a1a', 
        padding: '12px 16px',
        borderBottom: '1px solid #333'
      }}>
        <Group gap="xs">
          <IconBolt size={16} color="#fab005" />
          <Text size="sm" fw={500} c="white">Execution Test</Text>
        </Group>
      </Box>

      {/* Broker Profile Selector */}
      <Box style={{ 
        padding: '16px',
        borderBottom: '1px solid #333'
      }}>
        <Group justify="space-between" mb="xs">
          <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.5px' }}>
            Broker Profile
          </Text>
          <ActionIcon 
            size="xs" 
            variant="subtle"
            onClick={() => navigate('/settings')}
          >
            <IconSettings size={14} />
          </ActionIcon>
        </Group>
        
        {profiles.length > 0 ? (
          <Select
            value={activeProfileId}
            onChange={(value) => value && activateProfile(value)}
            data={profiles.map(profile => ({
              value: profile.id,
              label: `${profile.name} (${profile.broker})`
            }))}
            placeholder="Select broker profile"
            size="sm"
            styles={{
              input: {
                backgroundColor: '#1a1a1a',
                borderColor: '#444',
                color: '#fff',
                '&:hover': {
                  borderColor: '#555'
                }
              },
              dropdown: {
                backgroundColor: '#1a1a1a',
                borderColor: '#444'
              },
              item: {
                color: '#fff',
                '&[data-hovered]': {
                  backgroundColor: '#2a2a2a'
                }
              }
            }}
          />
        ) : (
          <Text size="sm" c="dimmed">No broker profiles configured</Text>
        )}
      </Box>

      {/* Connection Status */}
      <Box style={{ 
        padding: '12px 16px',
        borderBottom: '1px solid #333'
      }}>
        <Group justify="space-between">
          <Group gap="sm">
            {connectionStatus === 'connected' ? 
              <IconWifi size={16} color={connectionColor} /> : 
              <IconWifiOff size={16} color={connectionColor} />
            }
            <Text size="sm" c={connectionStatus === 'connected' ? 'green' : 'red'}>
              {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
            </Text>
          </Group>
          <Group gap="xs">
            <IconClock size={14} color="#666" />
            <Text size="sm" ff="monospace" c={latencyColor}>{currentLatency}ms</Text>
          </Group>
        </Group>
      </Box>

      {/* Test Controls */}
      <Box style={{ padding: '16px' }}>
        <Stack gap="sm">
          <Button 
            onClick={() => runTest('single')}
            disabled={testStatus === 'running' || !activeProfile}
            loading={testStatus === 'running'}
            leftSection={testStatus !== 'running' && <IconPlayerPlay size={16} />}
            fullWidth
          >
            {testStatus === 'running' ? 'Executing...' : 'Test Single Order'}
          </Button>

          <Button 
            onClick={() => runTest('stress')}
            disabled={testStatus === 'running' || !activeProfile}
            variant="default"
            leftSection={<IconActivity size={16} />}
            fullWidth
          >
            Stress Test
          </Button>

          <Button 
            onClick={() => setConnectionStatus(
              connectionStatus === 'connected' ? 'disconnected' : 'connected'
            )}
            variant="default"
            leftSection={<IconWifiOff size={16} />}
            fullWidth
          >
            Simulate Disconnect
          </Button>
        </Stack>
      </Box>

      {/* Test Results */}
      {testResults && (
        <Box style={{ 
          flex: 1, 
          padding: '16px',
          overflowY: 'auto'
        }}>
          <Text size="sm" fw={500} c="dimmed" mb="sm">Last Result</Text>
          
          <Paper 
            p="md" 
            mb="md"
            style={{ 
              background: '#1a1a1a',
              border: '1px solid #333'
            }}
          >
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Status</Text>
                <Group gap={4}>
                  {testResults.status === 'FILLED' ? 
                    <IconCircleCheck size={14} color="#40c057" /> : 
                    <IconX size={14} color="#fa5252" />
                  }
                  <Text 
                    size="sm" 
                    fw={500} 
                    c={testResults.status === 'FILLED' ? 'green' : 'red'}
                  >
                    {testResults.status}
                  </Text>
                </Group>
              </Group>

              <Group justify="space-between">
                <Text size="sm" c="dimmed">Fill Time</Text>
                <Text size="sm" c="white" ff="monospace">{testResults.executionTime}ms</Text>
              </Group>

              <Group justify="space-between">
                <Text size="sm" c="dimmed">Slippage</Text>
                <Text 
                  size="sm" 
                  ff="monospace"
                  c={parseFloat(testResults.slippage) > 0 ? 'red' : 'green'}
                >
                  {parseFloat(testResults.slippage) > 0 ? '+' : ''}{testResults.slippage} pips
                </Text>
              </Group>

              <Group justify="space-between">
                <Text size="sm" c="dimmed">Time</Text>
                <Text size="sm" c="dimmed" ff="monospace">{testResults.timestamp}</Text>
              </Group>
            </Stack>
          </Paper>

          {/* Session Stats */}
          <Paper 
            p="md"
            style={{ 
              background: '#1a1a1a',
              border: '1px solid #333'
            }}
          >
            <Text size="xs" fw={500} c="dimmed" mb="sm" tt="uppercase">
              Session Stats
            </Text>
            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Orders Tested</Text>
                <Text size="xs" c="white">127</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Success Rate</Text>
                <Text size="xs" c="green">98.4%</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Avg Latency</Text>
                <Text size="xs" c="white">42ms</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Max Slippage</Text>
                <Text size="xs" c="yellow">+1.2 pips</Text>
              </Group>
            </Stack>
          </Paper>

          {/* Deploy Button */}
          <Box mt="md">
            <Button 
              color="green"
              leftSection={<IconSend size={16} />}
              fullWidth
              disabled={!activeProfile}
            >
              Deploy to Production
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
};