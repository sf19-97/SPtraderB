import { useState, useEffect } from 'react';
import { Group, Text, Box, Paper } from '@mantine/core';
import { IconTrendingUp, IconTrendingDown } from '@tabler/icons-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface BitcoinTick {
  timestamp: string;
  symbol: string;
  bid: number;
  ask: number;
  last?: number;
}

interface BitcoinMarketDataBarProps {
  currentTimeframe?: string;
}

export const BitcoinMarketDataBar: React.FC<BitcoinMarketDataBarProps> = ({
  currentTimeframe = '1h',
}) => {
  const [marketData, setMarketData] = useState({
    price: 0,
    bid: 0,
    ask: 0,
    change: 0,
    changePercent: 0,
    high: 0,
    low: 0,
    volume: '0 BTC',
    spread: 0,
  });

  // Fetch real Bitcoin data from database
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    const fetchLatestData = async () => {
      try {
        // Get latest tick from database
        const latestTick = await invoke<any>('get_latest_bitcoin_tick');
        if (latestTick) {
          const price =
            latestTick.bid && latestTick.ask ? (latestTick.bid + latestTick.ask) / 2 : 0;
          const spread = latestTick.ask - latestTick.bid;

          // Get 24h stats
          const stats = await invoke<any>('get_bitcoin_24h_stats');

          setMarketData((prev) => ({
            price: price,
            bid: latestTick.bid,
            ask: latestTick.ask,
            spread: spread,
            high: stats?.high || prev.high,
            low: stats?.low || prev.low,
            change: stats?.change || 0,
            changePercent: stats?.change_percent || 0,
            volume: stats?.volume ? `${(stats.volume / 1000).toFixed(1)}K BTC` : '0 BTC',
          }));
        }
      } catch (error) {
        console.error('Failed to fetch Bitcoin data:', error);
      }
    };

    // Fetch immediately
    fetchLatestData();

    // Then update every 60 seconds
    interval = setInterval(fetchLatestData, 60000);

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, []);

  const isPositive = marketData.change > 0;

  // Format Bitcoin price with commas and no decimals
  const formatBitcoinPrice = (price: number): string => {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <Paper
      p="xs"
      style={{
        background: '#1a1a1a',
        borderBottom: '1px solid #333',
        borderRadius: 0,
      }}
    >
      <Group justify="space-between" gap="xl">
        {/* Bitcoin Price Section */}
        <Group gap="md">
          <Box style={{ width: '120px' }}>
            <Text size="lg" fw={600} c="#f7931a">
              BTC/USD
            </Text>
          </Box>

          {/* Timeframe display */}
          <Box
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              padding: '4px 12px',
              borderRadius: '4px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            <Text size="sm" fw={500} c="white">
              {currentTimeframe}
            </Text>
          </Box>

          <Box>
            <Text size="xl" fw={600} c="white">
              ${formatBitcoinPrice(marketData.price)}
            </Text>
            <Group gap="xs">
              {isPositive ? (
                <IconTrendingUp size={14} color="#00ff88" />
              ) : (
                <IconTrendingDown size={14} color="#ff4976" />
              )}
              <Text size="sm" c={isPositive ? '#00ff88' : '#ff4976'}>
                {isPositive ? '+' : ''}${formatBitcoinPrice(marketData.change)} (
                {marketData.changePercent}%)
              </Text>
            </Group>
          </Box>
        </Group>

        {/* Market Stats */}
        <Group gap="xl">
          <Box>
            <Text size="xs" c="dimmed">
              Bid
            </Text>
            <Text size="sm" fw={500}>
              ${formatBitcoinPrice(marketData.bid)}
            </Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Ask
            </Text>
            <Text size="sm" fw={500}>
              ${formatBitcoinPrice(marketData.ask)}
            </Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Spread
            </Text>
            <Text size="sm" fw={500}>
              ${marketData.spread.toFixed(2)}
            </Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              24h High
            </Text>
            <Text size="sm" fw={500}>
              ${formatBitcoinPrice(marketData.high)}
            </Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              24h Low
            </Text>
            <Text size="sm" fw={500}>
              ${formatBitcoinPrice(marketData.low)}
            </Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Volume
            </Text>
            <Text size="sm" fw={500}>
              {marketData.volume}
            </Text>
          </Box>
        </Group>

        {/* Live indicator */}
        <Box>
          <Group gap="xs">
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: '#00ff88',
                animation: 'pulse 2s infinite',
              }}
            />
            <Text size="xs" c="dimmed">
              LIVE
            </Text>
          </Group>
        </Box>
      </Group>

      <style>{`
        @keyframes pulse {
          0% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(1.1);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </Paper>
  );
};
