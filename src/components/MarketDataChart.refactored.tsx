import React, { useEffect, useRef } from 'react';
import { useActor } from '@xstate/react';
import { Box } from '@mantine/core';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { useChartMachine } from '../machines/chartStateMachine';
import { chartDataCoordinator } from '../services/ChartDataCoordinator';
import { useChartStore } from '../stores/useChartStore';

interface MarketDataChartProps {
  symbol?: string;
  timeframe?: string;
  onTimeframeChange?: (timeframe: string) => void;
}

/**
 * Refactored MarketDataChart using state machine
 * This is a demonstration of how the component would look with the state machine
 */
export const MarketDataChartRefactored: React.FC<MarketDataChartProps> = ({
  symbol = 'EURUSD',
  timeframe = '1h',
  onTimeframeChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  
  const { setCurrentTimeframe: setStoreTimeframe } = useChartStore();
  
  // Initialize state machine
  const {
    service,
    initialize,
    updateBarSpacing,
    setShiftPressed,
    setVisibleRange,
    notifyDataLoaded,
    notifyDataError,
  } = useChartMachine();
  
  // Get current state and context
  const [state, send] = useActor(service);
  const { opacity, timeframe: currentTimeframe, isShiftPressed } = state.context;

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    console.log('[MarketDataChart] Creating chart');
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { color: '#0d0d0d' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.6)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.6)' },
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
        rightBarStaysOnScroll: true,
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Initialize state machine
    initialize(symbol, timeframe);

    return () => {
      console.log('[MarketDataChart] Cleaning up chart');
      chart.remove();
    };
  }, []); // Only create chart once

  // Handle state machine state changes
  useEffect(() => {
    console.log('[MarketDataChart] State changed:', state.value, state.context);

    // Handle loading state
    if (state.matches('loading')) {
      loadChartData();
    }

    // Handle opacity changes
    if (containerRef.current) {
      containerRef.current.style.opacity = opacity.toString();
    }

    // Handle timeframe changes
    if (currentTimeframe !== timeframe && onTimeframeChange) {
      onTimeframeChange(currentTimeframe);
      setStoreTimeframe(currentTimeframe);
    }
  }, [state.value, opacity, currentTimeframe]);

  // Monitor bar spacing
  useEffect(() => {
    if (!chartRef.current) return;

    const checkInterval = setInterval(() => {
      try {
        const barSpacing = chartRef.current!.timeScale().options().barSpacing;
        updateBarSpacing(barSpacing);
      } catch (e) {
        console.error('[MarketDataChart] Error checking bar spacing:', e);
      }
    }, 100);

    return () => clearInterval(checkInterval);
  }, [updateBarSpacing]);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setShiftPressed]);

  // Track visible range
  useEffect(() => {
    if (!chartRef.current) return;

    const handleVisibleRangeChange = () => {
      const range = chartRef.current!.timeScale().getVisibleRange();
      if (range) {
        setVisibleRange({
          from: range.from as number,
          to: range.to as number,
        });
      }
    };

    chartRef.current.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange);

    return () => {
      chartRef.current?.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange);
    };
  }, [setVisibleRange]);

  // Load chart data
  const loadChartData = async () => {
    try {
      const data = await chartDataCoordinator.fetchChartData(
        state.context.symbol,
        state.context.timeframe
      );

      if (data.length > 0 && seriesRef.current) {
        seriesRef.current.setData(data as any);
        notifyDataLoaded();
      } else {
        notifyDataError('No data available');
      }
    } catch (error) {
      console.error('[MarketDataChart] Error loading data:', error);
      notifyDataError(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        position: 'relative',
        transition: 'opacity 250ms ease-in-out',
      }}
    >
      {state.matches('error') && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'red',
          }}
        >
          Error: {state.context.error}
        </Box>
      )}
    </Box>
  );
};