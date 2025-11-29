// src/pages/TradingPage.tsx
import { useState } from 'react';
import { Box } from '@mantine/core';
import { MarketDataBar } from '../components/MarketDataBar';
import { TradingRightSidebar } from '../components/TradingRightSidebar';
import { MarketDataChart } from 'sptrader-chart-lib';
import { useTradingStore } from '../stores/useTradingStore';

export const TradingPage = () => {
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const { selectedPair, selectedTimeframe, setTimeframe } = useTradingStore();
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);

  return (
    <Box style={{ display: 'flex', height: '100%', width: '100%' }}>
      {/* Main content area */}
      <Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Market Data Bar at top */}
        <MarketDataBar />

        {/* Chart area */}
        <Box style={{ flex: 1, background: '#0a0a0a', position: 'relative' }}>
          <MarketDataChart
            symbol={selectedPair}
            timeframe={selectedTimeframe}
            isFullscreen={isChartFullscreen}
            onToggleFullscreen={() => setIsChartFullscreen(!isChartFullscreen)}
            onTimeframeChange={(tf: string) => setTimeframe(tf)}
            preloadAdjacentTimeframes={true}
          />
        </Box>

      </Box>

      {/* Right sidebar - collapsible */}
      <TradingRightSidebar
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed(!rightCollapsed)}
      />
    </Box>
  );
};
