import { useState } from 'react';
import { Box } from '@mantine/core';
import { MarketDataBar } from '../components/MarketDataBar';
import MarketDataChart from '../components/MarketDataChart';
import { useTradingStore } from '../stores/useTradingStore';

export const MarketChartPage = () => {
  const { selectedPair } = useTradingStore();
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);

  return (
    <Box style={{ display: 'flex', height: '100vh', width: '100%', flexDirection: 'column' }}>
      {/* Market Data Bar at top */}
      <MarketDataBar />

      {/* Chart area */}
      <Box style={{ flex: 1, background: '#0a0a0a', position: 'relative' }}>
        <MarketDataChart
          symbol={selectedPair}
          isFullscreen={isChartFullscreen}
          onToggleFullscreen={() => setIsChartFullscreen(!isChartFullscreen)}
        />
      </Box>
    </Box>
  );
};
