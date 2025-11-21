import {
  AppShell,
  Burger,
  Group,
  Text,
  Stack,
  Tabs,
  Badge,
  Button,
  SegmentedControl,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconChartLine,
  IconActivityHeartbeat,
  IconShieldCheck,
  IconListDetails,
  IconChartBar,
  IconRefresh,
  IconArrowLeft,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useOrchestratorStore } from '../stores/useOrchestratorStore';

// Import components
import { StrategyList } from '../components/orchestrator/StrategyList';
import { BacktestPanel } from '../components/orchestrator/backtest/BacktestPanel';
// import { LiveTradingPanel } from '../components/orchestrator/live/LiveTradingPanel';
// import { PerformancePanel } from '../components/orchestrator/performance/PerformancePanel';
// import { RiskPanel } from '../components/orchestrator/risk/RiskPanel';

export function OrchestratorPage() {
  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const { mode, setMode, isConnected, selectedStrategy } = useOrchestratorStore();

  // Note: Log events are now handled via HTTP API polling instead of Tauri events

  const getModeColor = () => {
    switch (mode) {
      case 'backtest':
        return 'blue';
      case 'paper':
        return 'yellow';
      case 'live':
        return 'red';
      default:
        return 'gray';
    }
  };

  const getConnectionColor = () => {
    return isConnected ? 'green' : 'red';
  };

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 300,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      {/* Header */}
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text size="xl" fw={700}>
              SPtraderB Orchestrator
            </Text>
          </Group>

          <Group>
            {/* Mode Selector */}
            <SegmentedControl
              value={mode}
              onChange={(value) => setMode(value as 'backtest' | 'paper' | 'live')}
              data={[
                { label: 'Backtest', value: 'backtest' },
                { label: 'Paper', value: 'paper' },
                { label: 'Live', value: 'live' },
              ]}
              color={getModeColor()}
            />

            {/* Connection Status */}
            <Badge
              color={getConnectionColor()}
              size="lg"
              variant={isConnected ? 'light' : 'filled'}
            >
              {isConnected ? 'Connected' : 'Disconnected'}
            </Badge>

            {/* Back Button */}
            <Button
              leftSection={<IconArrowLeft size={16} />}
              variant="subtle"
              onClick={() => navigate('/')}
            >
              Back to Trading
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      {/* Sidebar - Strategy List */}
      <AppShell.Navbar p="md">
        <Stack h="100%" gap="md">
          <Group justify="space-between">
            <Text fw={600}>Strategies</Text>
            <Button size="xs" variant="subtle" leftSection={<IconRefresh size={16} />}>
              Refresh
            </Button>
          </Group>

          {selectedStrategy ? (
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                {selectedStrategy.name}
              </Text>
              <Text size="xs" c="dimmed">
                {selectedStrategy.description}
              </Text>
            </Stack>
          ) : (
            <Text c="dimmed" size="sm">
              No strategy selected
            </Text>
          )}

          <StrategyList />
        </Stack>
      </AppShell.Navbar>

      {/* Main Content Area */}
      <AppShell.Main>
        <Tabs defaultValue="backtest">
          <Tabs.List>
            <Tabs.Tab value="backtest" leftSection={<IconChartLine size={16} />}>
              Backtest
            </Tabs.Tab>
            <Tabs.Tab value="live" leftSection={<IconActivityHeartbeat size={16} />}>
              Live Trading
            </Tabs.Tab>
            <Tabs.Tab value="performance" leftSection={<IconChartBar size={16} />}>
              Performance
            </Tabs.Tab>
            <Tabs.Tab value="risk" leftSection={<IconShieldCheck size={16} />}>
              Risk
            </Tabs.Tab>
            <Tabs.Tab value="orders" leftSection={<IconListDetails size={16} />}>
              Orders
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="backtest" pt="xl">
            <BacktestPanel />
          </Tabs.Panel>

          <Tabs.Panel value="live" pt="xl">
            {/* <LiveTradingPanel /> */}
            <Text>Live trading panel coming soon...</Text>
          </Tabs.Panel>

          <Tabs.Panel value="performance" pt="xl">
            {/* <PerformancePanel /> */}
            <Text>Performance panel coming soon...</Text>
          </Tabs.Panel>

          <Tabs.Panel value="risk" pt="xl">
            {/* <RiskPanel /> */}
            <Text>Risk panel coming soon...</Text>
          </Tabs.Panel>

          <Tabs.Panel value="orders" pt="xl">
            <Text>Orders panel coming soon...</Text>
          </Tabs.Panel>
        </Tabs>
      </AppShell.Main>
    </AppShell>
  );
}
