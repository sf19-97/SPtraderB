import React, { useRef, useEffect } from 'react';
import { Box } from '@mantine/core';
import { useChartSetup } from '../../hooks/useChartSetup';
import { chartDataCoordinator } from '../../services/ChartDataCoordinator';

interface SimpleChartProps {
  symbol: string;
  timeframe: string;
}

/**
 * Example of using useChartSetup hook
 * Shows how much cleaner the component becomes
 */
export const SimpleChart: React.FC<SimpleChartProps> = ({ symbol, timeframe }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Single line replaces ~50 lines of setup code
  const { chart, series, isReady } = useChartSetup(containerRef);

  // Load data when ready
  useEffect(() => {
    if (!isReady || !series) return;

    const loadData = async () => {
      try {
        const data = await chartDataCoordinator.fetchChartData(symbol, timeframe);
        series.setData(data as any);
      } catch (error) {
        console.error('[SimpleChart] Error loading data:', error);
      }
    };

    loadData();
  }, [isReady, series, symbol, timeframe]);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    />
  );
};

/**
 * Example with custom theme
 */
export const ThemedChart: React.FC<SimpleChartProps> = ({ symbol, timeframe }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Custom light theme
  const { chart, series, isReady } = useChartSetup(containerRef, {
    theme: {
      backgroundColor: '#ffffff',
      textColor: '#191919',
      gridColor: 'rgba(0, 0, 0, 0.1)',
      borderColor: '#e0e0e0',
      upColor: '#4caf50',
      downColor: '#f44336',
      wickUpColor: '#4caf50',
      wickDownColor: '#f44336',
    },
    chartOptions: {
      timeScale: {
        barSpacing: 15, // Wider bars
      },
    },
  });

  // ... rest of component
  return <Box ref={containerRef} sx={{ width: '100%', height: '100%' }} />;
};