/**
 * BITCOIN TEST CHART - COPY OF AdaptiveChart.tsx
 * This is a SAFE COPY for testing Bitcoin data integration
 * The original AdaptiveChart.tsx remains completely untouched
 * 
 * Changes made for Bitcoin:
 * - Support for BTCUSD symbol
 * - Adjusted price formatting for larger values
 * - Connected to bitcoin_ticks/bitcoin_candles_* tables
 */

import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { invoke } from '@tauri-apps/api/core';
import { useChartStore } from '../stores/useChartStore';
import { ActionIcon, Group, Text, Box } from '@mantine/core';
import { IconMaximize, IconMinimize } from '@tabler/icons-react';

interface ChartData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface BitcoinTestChartProps {
  symbol?: string;
  timeframe?: string;
  onTimeframeChange?: (timeframe: string) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

interface SymbolMetadata {
  symbol: string;
  start_timestamp: number;
  end_timestamp: number;
  has_data: boolean;
}

const BitcoinTestChart: React.FC<BitcoinTestChartProps> = ({ 
  symbol = 'BTCUSD', // Default to Bitcoin
  timeframe,
  onTimeframeChange,
  isFullscreen = false,
  onToggleFullscreen
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  
  const [currentTimeframe, setCurrentTimeframe] = useState(timeframe || '1h');
  const currentTimeframeRef = useRef(timeframe || '1h');
  const symbolRef = useRef(symbol);
  const [isLoading, setIsLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [chartOpacity, setChartOpacity] = useState(1);
  
  // Zustand store - using same store but different cache keys for Bitcoin
  const {
    getCachedData,
    setCachedData,
    getScrollPosition,
    setScrollPosition,
  } = useChartStore();

  // Bitcoin-specific: Adjusted candle width thresholds
  const BITCOIN_CANDLE_WIDTH_LOWER_THRESHOLD = 5; 
  const BITCOIN_CANDLE_WIDTH_UPPER_THRESHOLD = 30;

  const timeframeHierarchy = ['15m', '1h', '4h', '12h'];

  const shouldCheckCandleWidth = (tf: string): boolean => {
    return timeframeHierarchy.includes(tf);
  };

  // Format large Bitcoin prices
  const formatBitcoinPrice = (price: number): string => {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }
    return `$${price.toFixed(2)}`;
  };

  const fetchChartData = async (sym: string, tf: string): Promise<{ data: ChartData[], metadata: SymbolMetadata | null }> => {
    try {
      // IMPORTANT: For Bitcoin, we'll use a different command that queries bitcoin_candles_* tables
      const response = await invoke<any>('get_bitcoin_chart_data', { 
        symbol: sym, 
        timeframe: tf 
      });
      
      if (response.data && response.data.length > 0) {
        const chartData = response.data.map((candle: any) => ({
          time: Math.floor(new Date(candle.time).getTime() / 1000),
          open: parseFloat(candle.open),
          high: parseFloat(candle.high),
          low: parseFloat(candle.low),
          close: parseFloat(candle.close),
        }));
        
        return { 
          data: chartData, 
          metadata: response.metadata || null 
        };
      }
      return { data: [], metadata: null };
    } catch (error) {
      console.error(`Error fetching Bitcoin chart data for ${sym} ${tf}:`, error);
      return { data: [], metadata: null };
    }
  };

  // Rest of the component logic remains the same as AdaptiveChart
  // Just using Bitcoin-specific data fetching and formatting...

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart with Bitcoin-friendly settings
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: isFullscreen ? window.innerHeight - 100 : 400,
      layout: {
        background: { color: '#1a1a1a' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#2B2B43',
        // Bitcoin needs more space for large prices
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: '#2B2B43',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceFormat: {
        type: 'custom',
        formatter: formatBitcoinPrice,
      },
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: isFullscreen ? window.innerHeight - 100 : 400,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [isFullscreen]);

  // Load data effect
  useEffect(() => {
    const loadData = async () => {
      if (!seriesRef.current || !chartRef.current) return;
      
      setIsLoading(true);
      symbolRef.current = symbol;
      
      try {
        const cacheKey = `bitcoin_${symbol}_${currentTimeframe}`;
        const cachedData = getCachedData(cacheKey);
        
        if (cachedData && cachedData.length > 0) {
          seriesRef.current.setData(cachedData);
          const savedPosition = getScrollPosition(cacheKey);
          if (savedPosition) {
            chartRef.current.timeScale().setVisibleRange(savedPosition);
          }
        } else {
          const { data } = await fetchChartData(symbol, currentTimeframe);
          if (data.length > 0) {
            seriesRef.current.setData(data);
            setCachedData(cacheKey, data);
            chartRef.current.timeScale().fitContent();
          }
        }
      } catch (error) {
        console.error('Error loading Bitcoin chart data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [symbol, currentTimeframe]);

  return (
    <Box style={{ position: 'relative', opacity: chartOpacity, transition: 'opacity 0.3s ease' }}>
      <Group 
        justify="space-between" 
        mb="sm" 
        style={{ 
          position: 'absolute', 
          top: 10, 
          left: 10, 
          right: 10, 
          zIndex: 10,
          backgroundColor: 'rgba(26, 26, 26, 0.8)',
          padding: '8px 12px',
          borderRadius: '4px'
        }}
      >
        <Group>
          <Text size="lg" fw={700} c="white">
            Bitcoin Test Chart - {symbol}
          </Text>
          <Text size="sm" c="dimmed">
            {currentTimeframe}
          </Text>
          {isLoading && <Text size="xs" c="blue">Loading...</Text>}
          {isTransitioning && <Text size="xs" c="yellow">Switching timeframe...</Text>}
        </Group>
        {onToggleFullscreen && (
          <ActionIcon 
            onClick={onToggleFullscreen} 
            variant="subtle"
            color="gray"
          >
            {isFullscreen ? <IconMinimize size={18} /> : <IconMaximize size={18} />}
          </ActionIcon>
        )}
      </Group>
      <div 
        ref={chartContainerRef} 
        style={{ 
          width: '100%',
          height: isFullscreen ? 'calc(100vh - 100px)' : '400px',
        }} 
      />
    </Box>
  );
};

export default BitcoinTestChart;