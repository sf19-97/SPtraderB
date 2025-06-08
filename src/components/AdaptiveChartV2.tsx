// src/components/AdaptiveChartV2.tsx
import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { invoke } from '@tauri-apps/api/core';

interface ChartData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface AdaptiveChartV2Props {
  symbol?: string;
  timeframe?: string;
  onTimeframeChange?: (timeframe: string) => void;
}

const TIMEFRAMES = ['15m', '1h', '4h', '12h'];
const MIN_CANDLE_WIDTH = 5;
const MAX_CANDLE_WIDTH = 30;

export const AdaptiveChartV2: React.FC<AdaptiveChartV2Props> = ({ 
  symbol = 'EURUSD',
  timeframe = '1h',
  onTimeframeChange 
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  
  const [currentTimeframe, setCurrentTimeframe] = useState(timeframe);
  const [isLoading, setIsLoading] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>('V2 Chart Ready');

  useEffect(() => {
    console.log('🟢 [V2] Chart initializing');
    const timer = setTimeout(() => {
      if (chartContainerRef.current && !chartRef.current) {
        initializeChart();
      }
    }, 100);
    
    return () => {
      console.log('🔴 [V2] Chart cleanup');
      clearTimeout(timer);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (timeframe !== currentTimeframe) {
      loadChartData(timeframe);
    }
  }, [timeframe]);

  const initializeChart = () => {
    if (!chartContainerRef.current) return;

    console.log('[V2] Creating chart instance');

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0a0a0a' },
        textColor: '#ffffff',
      },
      grid: {
        vertLines: { color: '#1a2a3a' },
        horzLines: { color: '#1a2a3a' },
      },
      crosshair: {
        mode: 0,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 15,
        rightOffset: 12,
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88',
      downColor: '#ff4976',
      borderVisible: false,
      wickUpColor: '#00ff88',
      wickDownColor: '#ff4976',
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    // Handle window resize
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight
        });
      }
    };
    window.addEventListener('resize', handleResize);
    
    // Set up zoom monitoring
    setupZoomMonitoring(chart);
    
    // Load initial data
    loadChartData(currentTimeframe);
  };

  const setupZoomMonitoring = (chart: IChartApi) => {
    let zoomTimeout: number | null = null;
    
    const handleRangeChange = () => {
      if (!chartRef.current || !seriesRef.current) return;
      
      if (zoomTimeout) clearTimeout(zoomTimeout);
      
      zoomTimeout = setTimeout(() => {
        checkZoomLevel();
      }, 200);
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);
  };

  const checkZoomLevel = () => {
    if (!chartRef.current || !seriesRef.current) return;
    
    const timeScale = chartRef.current.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    
    if (!visibleRange) return;
    
    // Count actual visible candles
    const visibleData = seriesRef.current.data();
    let visibleCandles = 0;
    
    for (const candle of visibleData) {
      const time = candle.time as number;
      if (time >= (visibleRange.from as number) && time <= (visibleRange.to as number)) {
        visibleCandles++;
      }
    }
    
    const chartWidth = chartContainerRef.current!.clientWidth;
    const candleWidth = chartWidth / visibleCandles;
    
    setDebugInfo(`[V2] ${currentTimeframe} - ${visibleCandles} candles, ${candleWidth.toFixed(1)}px width`);
    
    // For V2, we'll implement smarter switching later
    console.log(`[V2] Candle width: ${candleWidth.toFixed(2)}px (${visibleCandles} candles)`);
  };

  const loadChartData = async (newTimeframe: string) => {
    setIsLoading(true);
    setCurrentTimeframe(newTimeframe);
    
    try {
      console.log(`[V2] Loading ${newTimeframe} data using hierarchical query`);
      
      // For now, use the regular fetch_candles until we implement fetch_candles_v2
      const data = await invoke<ChartData[]>('fetch_candles', {
        request: {
          symbol: symbol,
          timeframe: newTimeframe,
          from: 1704153600, // Jan 2, 2024
          to: 1717200000,   // May 31, 2024
        },
      });

      if (!data || data.length === 0) {
        console.error('[V2] No data received');
        return;
      }

      console.log(`[V2] Received ${data.length} candles`);

      const formattedData = data.map(candle => ({
        time: candle.time as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      if (!seriesRef.current || !chartRef.current) {
        console.log('[V2] Chart disposed during data load');
        return;
      }

      seriesRef.current.setData(formattedData);
      
      // Set initial view
      if (formattedData.length > 100) {
        let visibleCandles = 100;
        
        switch(newTimeframe) {
          case '15m':
            visibleCandles = 192;
            break;
          case '1h':
            visibleCandles = 168;
            break;
          case '4h':
            visibleCandles = 84;
            break;
          case '12h':
            visibleCandles = 120;
            break;
        }
        
        const endIndex = formattedData.length - 1;
        const startIndex = Math.max(0, endIndex - visibleCandles);
        
        if (chartRef.current) {
          chartRef.current.timeScale().setVisibleRange({
            from: formattedData[startIndex].time,
            to: formattedData[endIndex].time
          });
        }
      }
      
    } catch (error) {
      console.error('[V2] Failed to load chart data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div 
        ref={chartContainerRef} 
        style={{ 
          width: '100%',
          height: '100%',
          background: '#0a0a0a',
        }}
      />
      
      {/* Debug overlay */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: '#00ff88',
        padding: '5px 10px',
        borderRadius: '4px',
        fontSize: '12px',
        fontFamily: 'monospace',
        border: '1px solid #00ff88',
      }}>
        {debugInfo}
      </div>
      
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          color: '#fff',
          background: 'rgba(0,0,0,0.5)',
          padding: '5px 10px',
          borderRadius: '4px',
          zIndex: 10
        }}>
          Loading V2...
        </div>
      )}
    </div>
  );
};