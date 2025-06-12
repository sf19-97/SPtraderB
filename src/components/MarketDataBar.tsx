// src/components/MarketDataBar.tsx
import { Group, Text, Box, Paper, Badge } from '@mantine/core';
import { IconTrendingUp, IconTrendingDown, IconClock } from '@tabler/icons-react';
import { useTrading } from '../contexts/TradingContext';
import { useState, useEffect } from 'react';

export const MarketDataBar = () => {
  const { selectedPair, selectedTimeframe } = useTrading();
  const [timeframeChanged, setTimeframeChanged] = useState(false);
  
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

  // Animate on timeframe change
  useEffect(() => {
    setTimeframeChanged(true);
    const timer = setTimeout(() => setTimeframeChanged(false), 300);
    return () => clearTimeout(timer);
  }, [selectedTimeframe]);

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
        {/* Price Section */}
        <Group gap="md">
          <Box>
            <Text size="xl" fw={700} c="white">
              {selectedPair.slice(0, 3)}/{selectedPair.slice(3)}
            </Text>
          </Box>
          
          <Box>
            <Text size="xl" fw={600} c="white">
              {marketData.price.toFixed(5)}
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

        {/* Timeframe Display - Read Only */}
        <Box
          style={{
            background: 'linear-gradient(145deg, #1a1a1a, #0a0a0a)',
            border: '1px solid #333',
            borderRadius: '20px',
            padding: '6px 16px',
            position: 'relative',
            overflow: 'hidden',
            minWidth: '80px',
          }}
        >
          <Group gap="xs" justify="center">
            <Box
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#00ff88',
                opacity: timeframeChanged ? 1 : 0.6,
                transition: 'opacity 0.3s ease',
              }}
            />
            <Text size="sm" fw={600} c="white">
              {selectedTimeframe.toUpperCase()}
            </Text>
          </Group>
          
          {/* Glow effect on change */}
          <Box
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 255, 136, 0.2)',
              opacity: timeframeChanged ? 1 : 0,
              transition: 'opacity 0.3s ease',
              pointerEvents: 'none',
            }}
          />
        </Box>
      </Group>
    </Paper>
  );
};