import { Modal, Stack, Text, Title, Box, Group, Badge, Paper, List, ThemeIcon } from '@mantine/core';
import { IconStack3, IconBolt, IconTrendingUp, IconBox, IconArrowDown, IconCheck } from '@tabler/icons-react';

interface IDEHelpModalProps {
  opened: boolean;
  onClose: () => void;
  currentType: 'indicator' | 'signal' | 'order' | 'strategy';
}

export const IDEHelpModal = ({ opened, onClose, currentType }: IDEHelpModalProps) => {
  const getTypeInfo = () => {
    switch (currentType) {
      case 'indicator':
        return {
          icon: <IconStack3 size={24} />,
          color: 'blue',
          title: 'Indicators',
          description: 'Pure mathematical calculations. The foundation of your trading system.',
          canSee: [],
          purpose: 'Calculate values like RSI, moving averages, volatility metrics',
          example: 'An RSI indicator that outputs a value between 0-100'
        };
      case 'signal':
        return {
          icon: <IconBolt size={24} />,
          color: 'yellow',
          title: 'Signals',
          description: 'Combine indicators with logic to detect trading opportunities.',
          canSee: ['Indicators'],
          purpose: 'Define when to potentially enter or exit trades',
          example: 'RSI < 30 AND price above 200-day SMA = oversold in uptrend'
        };
      case 'order':
        return {
          icon: <IconTrendingUp size={24} />,
          color: 'green',
          title: 'Order Execution',
          description: 'Algorithms that determine HOW to execute trades.',
          canSee: ['Signals'],
          purpose: 'Smart order routing, position sizing, and execution tactics',
          example: 'Iceberg order that only shows 10% of total size to the market'
        };
      case 'strategy':
        return {
          icon: <IconBox size={24} />,
          color: 'purple',
          title: 'Strategies',
          description: 'Complete trading systems that orchestrate everything.',
          canSee: ['Indicators', 'Signals', 'Orders'],
          purpose: 'Combine all components with risk management rules',
          example: 'Momentum strategy using RSI signals with iceberg orders'
        };
    }
  };

  const typeInfo = getTypeInfo();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="sm">
          <ThemeIcon color={typeInfo.color} size="lg" radius="md">
            {typeInfo.icon}
          </ThemeIcon>
          <div>
            <Title order={4}>Building {typeInfo.title}</Title>
            <Text size="xs" c="dimmed">Understanding the architecture</Text>
          </div>
        </Group>
      }
      size="lg"
      padding="xl"
    >
      <Stack gap="lg">
        {/* Current Component Type */}
        <Paper p="md" withBorder style={{ borderColor: `var(--mantine-color-${typeInfo.color}-6)` }}>
          <Text size="sm" fw={500} mb="xs">{typeInfo.description}</Text>
          <Text size="xs" c="dimmed">{typeInfo.purpose}</Text>
        </Paper>

        {/* Visibility Rules */}
        <Box>
          <Text size="sm" fw={500} mb="sm">What You Can Access:</Text>
          {typeInfo.canSee.length === 0 ? (
            <Paper p="sm" bg="dark.8">
              <Text size="sm" c="dimmed">
                ⚡ No dependencies - {currentType}s are pure functions that cannot import other components
              </Text>
            </Paper>
          ) : (
            <Stack gap="xs">
              {typeInfo.canSee.map((item) => (
                <Paper key={item} p="sm" bg="dark.8">
                  <Group gap="sm">
                    <ThemeIcon size="sm" color="gray" variant="light">
                      <IconCheck size={14} />
                    </ThemeIcon>
                    <Text size="sm">{item}</Text>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>

        {/* Architecture Diagram */}
        <Box>
          <Text size="sm" fw={500} mb="sm">System Architecture:</Text>
          <Paper p="md" bg="dark.8">
            <Stack gap="xs" align="center">
              <Badge size="lg" color="purple" variant="filled">Strategies</Badge>
              <IconArrowDown size={16} style={{ opacity: 0.5 }} />
              <Group gap="xs">
                <Badge size="lg" color="green" variant="filled">Orders</Badge>
                <Badge size="lg" color="yellow" variant="filled">Signals</Badge>
              </Group>
              <IconArrowDown size={16} style={{ opacity: 0.5 }} />
              <Badge size="lg" color="blue" variant="filled">Indicators</Badge>
            </Stack>
            <Text size="xs" c="dimmed" ta="center" mt="md">
              Components can only import from lower levels
            </Text>
          </Paper>
        </Box>

        {/* Example */}
        <Box>
          <Text size="sm" fw={500} mb="xs">Example:</Text>
          <Paper p="sm" bg="dark.7" style={{ fontFamily: 'monospace' }}>
            <Text size="xs">{typeInfo.example}</Text>
          </Paper>
        </Box>

        {/* Best Practices */}
        <Box>
          <Text size="sm" fw={500} mb="sm">Best Practices:</Text>
          <List size="sm" spacing="xs">
            {currentType === 'indicator' && (
              <>
                <List.Item>Keep calculations pure - no side effects</List.Item>
                <List.Item>Always validate for NaN/Infinity values</List.Item>
                <List.Item>Optimize for vectorized operations</List.Item>
              </>
            )}
            {currentType === 'signal' && (
              <>
                <List.Item>Combine 2-4 indicators maximum</List.Item>
                <List.Item>Make conditions clear and testable</List.Item>
                <List.Item>Document the trading thesis</List.Item>
              </>
            )}
            {currentType === 'order' && (
              <>
                <List.Item>Handle partial fills gracefully</List.Item>
                <List.Item>Implement proper error handling</List.Item>
                <List.Item>Consider market impact and slippage</List.Item>
              </>
            )}
            {currentType === 'strategy' && (
              <>
                <List.Item>Always include risk management</List.Item>
                <List.Item>Test across different market conditions</List.Item>
                <List.Item>Start simple, add complexity gradually</List.Item>
              </>
            )}
          </List>
        </Box>

        {/* Quick Tips */}
        <Paper p="md" bg="blue.9" style={{ borderLeft: '4px solid var(--mantine-color-blue-5)' }}>
          <Group gap="sm" mb="xs">
            <Text size="sm" fw={500}>💡 Pro Tip:</Text>
          </Group>
          <Text size="xs">
            {currentType === 'indicator' && "Test your indicators on historical data before using them in signals"}
            {currentType === 'signal' && "Use the backtester to verify signal accuracy before building strategies"}
            {currentType === 'order' && "Start with simple execution, then add sophistication based on market conditions"}
            {currentType === 'strategy' && "Paper trade for at least 30 days before going live"}
          </Text>
        </Paper>
      </Stack>
    </Modal>
  );
};