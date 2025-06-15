// src/components/MarketDataBar.tsx
import { Group, Text, Box, Paper } from '@mantine/core';
import { IconTrendingUp, IconTrendingDown } from '@tabler/icons-react';
import { useTrading } from '../contexts/TradingContext';
import { ResolutionTracker } from './ResolutionTracker';
import { PairSelector } from './PairSelector';

export const MarketDataBar = () => {
  const { selectedPair } = useTrading();
  
  // Mock data - replace with real data
  const marketData = {
    price: 1.0856,
    change: 0.0012,
    changePercent: 0.11,
    high: 1.0892,
    low: 1.0823,
    volume: '1.2B',
    spread: 0.8,
  };

  const isPositive = marketData.change > 0;

  return (
    <Paper 
      p="xs" 
      style={{ 
        background: '#1a1a1a', 
        borderBottom: '1px solid #333',
        borderRadius: 0 
      }}
    >
      <Group justify="space-between" gap="xl">
        {/* Pair Selector and Price Section */}
        <Group gap="md">
          <Box style={{ width: '120px' }}>
            <PairSelector />
          </Box>
          
          <Box>
            <Text size="xl" fw={600} c="white">
              {marketData.price.toFixed(4)}
            </Text>
            <Group gap="xs">
              {isPositive ? 
                <IconTrendingUp size={14} color="#00ff88" /> : 
                <IconTrendingDown size={14} color="#ff4976" />
              }
              <Text size="sm" c={isPositive ? '#00ff88' : '#ff4976'}>
                {isPositive ? '+' : ''}{marketData.change.toFixed(5)} ({marketData.changePercent}%)
              </Text>
            </Group>
          </Box>
        </Group>

        {/* Market Stats */}
        <Group gap="xl">
          <Box>
            <Text size="xs" c="dimmed">24h High</Text>
            <Text size="sm" fw={500}>{marketData.high.toFixed(5)}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">24h Low</Text>
            <Text size="sm" fw={500}>{marketData.low.toFixed(5)}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Volume</Text>
            <Text size="sm" fw={500}>{marketData.volume}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Spread</Text>
            <Text size="sm" fw={500}>{marketData.spread}</Text>
          </Box>
        </Group>

        {/* Resolution Tracker - VISUAL ONLY */}
        <ResolutionTracker />
      </Group>
    </Paper>
  );
};