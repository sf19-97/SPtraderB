import { Group, SegmentedControl, Select, Chip, Paper, Text, ActionIcon } from '@mantine/core';
import { IconChartCandle, IconChartLine, IconChartBar } from '@tabler/icons-react';
import { useTrading } from '../contexts/TradingContext';

export const TradingControls = () => {
  const { 
    selectedTimeframe, 
    setTimeframe, 
    chartType, 
    setChartType,
    indicators,
    toggleIndicator 
  } = useTrading();

  const timeframes = [
    { label: '15m', value: '15m' },
    { label: '1h', value: '1h' },
    { label: '4h', value: '4h' },
    { label: '12h', value: '12h' },
  ];

  return (
    <Paper 
      p="xs" 
      style={{ 
        background: '#1a1a1a', 
        borderBottom: '1px solid #333',
        borderRadius: 0 
      }}
    >
      <Group justify="space-between">
        {/* Timeframe Selector */}
        <SegmentedControl
          value={selectedTimeframe}
          onChange={setTimeframe}
          data={timeframes}
          size="xs"
          styles={{
            root: { background: '#0a0a0a' },
            indicator: { background: '#2a2a2a' },
          }}
        />

        {/* Indicators as Chips */}
        <Group gap="xs">
          <Text size="xs" c="dimmed">Indicators:</Text>
          <Chip
            checked={indicators.ma}
            onChange={() => toggleIndicator('ma')}
            size="xs"
            variant="filled"
          >
            MA
          </Chip>
          <Chip
            checked={indicators.rsi}
            onChange={() => toggleIndicator('rsi')}
            size="xs"
            variant="filled"
          >
            RSI
          </Chip>
          <Chip
            checked={indicators.macd}
            onChange={() => toggleIndicator('macd')}
            size="xs"
            variant="filled"
          >
            MACD
          </Chip>
          <Chip
            checked={indicators.volume}
            onChange={() => toggleIndicator('volume')}
            size="xs"
            variant="filled"
          >
            Volume
          </Chip>
        </Group>

        {/* Chart Type - Icon buttons */}
        <Group gap={4}>
          <ActionIcon
            variant={chartType === 'candlestick' ? 'filled' : 'subtle'}
            size="sm"
            onClick={() => setChartType('candlestick')}
          >
            <IconChartCandle size={16} />
          </ActionIcon>
          <ActionIcon
            variant={chartType === 'line' ? 'filled' : 'subtle'}
            size="sm"
            onClick={() => setChartType('line')}
          >
            <IconChartLine size={16} />
          </ActionIcon>
          <ActionIcon
            variant={chartType === 'bar' ? 'filled' : 'subtle'}
            size="sm"
            onClick={() => setChartType('bar')}
          >
            <IconChartBar size={16} />
          </ActionIcon>
        </Group>
      </Group>
    </Paper>
  );
};