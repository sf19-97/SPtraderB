// src/components/TradingRightSidebar.tsx
import { Stack, Title, Text, Switch, Button, NumberInput, Divider, Box, Group, ActionIcon } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useTrading } from '../contexts/TradingContext';

interface TradingRightSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export const TradingRightSidebar = ({ collapsed, onToggle }: TradingRightSidebarProps) => {
  const { indicators, toggleIndicator } = useTrading();

  if (collapsed) {
    return (
      <Box
        style={{
          width: '40px',
          height: '100%',
          backgroundColor: '#151515',
          borderLeft: '1px solid #333',
          display: 'flex',
          alignItems: 'flex-start',
          paddingTop: '20px',
          justifyContent: 'center',
        }}
      >
        <ActionIcon
          onClick={onToggle}
          variant="subtle"
          color="gray"
          size="md"
        >
          <IconChevronLeft size={16} />
        </ActionIcon>
      </Box>
    );
  }

  return (
    <>
      {/* Overlay panel */}
      <Box
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '280px',
          height: '100vh',
          backgroundColor: '#151515',
          borderLeft: '1px solid #333',
          zIndex: 100,
          boxShadow: '-4px 0 10px rgba(0,0,0,0.5)',
          overflowY: 'auto',
        }}
      >
        <Stack p="md" gap="lg">
          {/* Header with close button */}
          <Group justify="space-between">
            <Title order={4} c="white">Trading Panel</Title>
            <ActionIcon
              onClick={onToggle}
              variant="subtle"
              color="gray"
              size="sm"
            >
              <IconChevronRight size={16} />
            </ActionIcon>
          </Group>

          {/* Indicators Section */}
          <Box>
            <Text size="sm" c="dimmed" mb="xs">Indicators</Text>
            <Stack gap="xs">
              <Switch
                label="Moving Averages"
                checked={indicators.ma}
                onChange={() => toggleIndicator('ma')}
                size="sm"
              />
              <Switch
                label="RSI"
                checked={indicators.rsi}
                onChange={() => toggleIndicator('rsi')}
                size="sm"
              />
              <Switch
                label="MACD"
                checked={indicators.macd}
                onChange={() => toggleIndicator('macd')}
                size="sm"
              />
              <Switch
                label="Volume"
                checked={indicators.volume}
                onChange={() => toggleIndicator('volume')}
                size="sm"
              />
            </Stack>
          </Box>

          <Divider />

          {/* Quick Order Section */}
          <Box>
            <Text size="sm" c="dimmed" mb="xs">Quick Order</Text>
            <Stack gap="sm">
              <NumberInput
                label="Amount"
                defaultValue={1.0}
                decimalScale={2}
                step={0.1}
                size="sm"
              />
              <Group grow>
                <Button color="green" size="sm">Buy</Button>
                <Button color="red" size="sm">Sell</Button>
              </Group>
            </Stack>
          </Box>

          <Divider />

          {/* Position Info */}
          <Box>
            <Text size="sm" c="dimmed" mb="xs">Open Positions</Text>
            <Text size="xs" c="dimmed">No open positions</Text>
          </Box>
        </Stack>
      </Box>

      {/* Dark overlay */}
      <Box
        onClick={onToggle}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: '280px',
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          zIndex: 99,
          cursor: 'pointer',
        }}
      />
    </>
  );
};