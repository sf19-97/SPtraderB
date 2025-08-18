import React, { useRef, useEffect } from 'react';
import { Box, Button, Group, Text } from '@mantine/core';
import { useChartSetup } from '../../hooks/useChartSetup';
import { useChartZoom } from '../../hooks/useChartZoom';
import { chartDataCoordinator } from '../../services/ChartDataCoordinator';

interface ZoomableChartProps {
  symbol: string;
  timeframe: string;
  onBarSpacingChange?: (barSpacing: number) => void;
}

/**
 * Example of using useChartZoom hook
 * Shows how zoom functionality is cleanly separated
 */
export const ZoomableChart: React.FC<ZoomableChartProps> = ({ 
  symbol, 
  timeframe,
  onBarSpacingChange 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Setup chart
  const { chart, series, isReady } = useChartSetup(containerRef);
  
  // Add zoom functionality with one line
  const { 
    isShiftPressed, 
    barSpacing, 
    visibleRange,
    zoomIn, 
    zoomOut, 
    resetZoom 
  } = useChartZoom(chart, {
    onBarSpacingChange,
  });

  // Load data
  useEffect(() => {
    if (!isReady || !series) return;

    const loadData = async () => {
      try {
        const data = await chartDataCoordinator.fetchChartData(symbol, timeframe);
        series.setData(data as any);
      } catch (error) {
        console.error('[ZoomableChart] Error loading data:', error);
      }
    };

    loadData();
  }, [isReady, series, symbol, timeframe]);

  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Chart container */}
      <Box
        ref={containerRef}
        sx={{
          width: '100%',
          height: 'calc(100% - 60px)',
          position: 'relative',
        }}
      />
      
      {/* Zoom controls */}
      <Group position="apart" p="sm" sx={{ height: 60 }}>
        <Group>
          <Button size="xs" onClick={() => zoomIn()}>
            Zoom In
          </Button>
          <Button size="xs" onClick={() => zoomOut()}>
            Zoom Out
          </Button>
          <Button size="xs" onClick={resetZoom}>
            Reset
          </Button>
        </Group>
        
        <Group>
          <Text size="sm" color="dimmed">
            Bar Spacing: {barSpacing.toFixed(1)}
          </Text>
          {isShiftPressed && (
            <Text size="sm" color="yellow">
              Shift Lock Active
            </Text>
          )}
          {visibleRange && (
            <Text size="sm" color="dimmed">
              Range: {new Date(visibleRange.from * 1000).toLocaleDateString()} - 
              {new Date(visibleRange.to * 1000).toLocaleDateString()}
            </Text>
          )}
        </Group>
      </Group>
    </Box>
  );
};

/**
 * Example integrating zoom with automatic timeframe switching
 */
export const AutoSwitchChart: React.FC<ZoomableChartProps> = ({ symbol, timeframe: initialTimeframe }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentTimeframe, setCurrentTimeframe] = React.useState(initialTimeframe);
  
  const { chart, series, isReady } = useChartSetup(containerRef);
  
  // Use zoom hook to monitor bar spacing
  const { barSpacing, isShiftPressed } = useChartZoom(chart, {
    onBarSpacingChange: (spacing) => {
      // Simple auto-switch logic
      if (currentTimeframe === '1h' && spacing > 32) {
        console.log('[AutoSwitchChart] Switching to 15m');
        setCurrentTimeframe('15m');
      } else if (currentTimeframe === '15m' && spacing < 8) {
        console.log('[AutoSwitchChart] Switching to 1h');
        setCurrentTimeframe('1h');
      }
    },
  });

  // Load data when timeframe changes
  useEffect(() => {
    if (!isReady || !series) return;

    const loadData = async () => {
      const data = await chartDataCoordinator.fetchChartData(symbol, currentTimeframe);
      series.setData(data as any);
    };

    loadData();
  }, [isReady, series, symbol, currentTimeframe]);

  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
      <Box ref={containerRef} sx={{ width: '100%', height: '100%' }} />
      
      {/* Status overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: 10,
          right: 10,
          background: 'rgba(0,0,0,0.7)',
          padding: 'sm',
          borderRadius: 4,
        }}
      >
        <Text size="sm">Timeframe: {currentTimeframe}</Text>
        <Text size="sm">Bar Spacing: {barSpacing.toFixed(1)}</Text>
        {isShiftPressed && <Text size="sm" color="yellow">Shift Lock</Text>}
      </Box>
    </Box>
  );
};