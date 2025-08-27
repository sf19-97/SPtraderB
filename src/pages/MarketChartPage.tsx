import { useState } from 'react';
import { Box } from '@mantine/core';
import { MarketDataBar } from '../components/MarketDataBar';
import MarketDataChart from '../components/MarketDataChart';
import { useTradingStore, useHydration } from '../stores/useTradingStore';
import { ErrorBoundary } from '../components/ErrorBoundary';

export const MarketChartPage = () => {
  const { selectedPair } = useTradingStore();
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const hydrated = useHydration();

  return (
    <Box style={{ display: 'flex', height: '100vh', width: '100%', flexDirection: 'column' }}>
      {/* Market Data Bar at top */}
      <MarketDataBar />

      {/* Chart area */}
      <Box style={{ flex: 1, background: '#0a0a0a', position: 'relative' }}>
        {!hydrated ? (
          <Box style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ color: '#666' }}>Loading chart...</div>
          </Box>
        ) : (
          <ErrorBoundary>
            <MarketDataChart
              symbol={selectedPair}
              isFullscreen={isChartFullscreen}
              onToggleFullscreen={() => setIsChartFullscreen(!isChartFullscreen)}
            />
          </ErrorBoundary>
        )}
      </Box>
    </Box>
  );
};
