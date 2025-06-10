// src/components/AdaptiveChartV2.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickSeries, LogicalRange } from 'lightweight-charts';
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
  onDetailLevelChange?: (detailLevel: string) => void;
}

interface PerformanceMetrics {
  fetchTime: number;
  renderTime: number;
  detailLevel: string;
  candleCount: number;
  barSpacing: number;
}

export const AdaptiveChartV2: React.FC<AdaptiveChartV2Props> = ({ 
  symbol = 'EURUSD',
  timeframe = '1h',
  onTimeframeChange,
  onDetailLevelChange
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const handleVisibleRangeChangeRef = useRef<((range: any) => void) | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>('[V2] Initializing...');
  const [currentDetailLevel, setCurrentDetailLevel] = useState<string>('1h');
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    console.log('🟢 [V2] Chart effect starting');
    
    const timer = setTimeout(() => {
      if (chartContainerRef.current && !chartRef.current) {
        console.log('🟡 [V2] Initializing chart');
        initializeChart();
      }
    }, 100);
    
    return () => {
      console.log('🔴 [V2] Chart cleanup');
      clearTimeout(timer);
      if (chartRef.current && handleVisibleRangeChangeRef.current) {
        chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChangeRef.current);
        handleVisibleRangeChangeRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      seriesRef.current = null;
    };
  }, []);

  const calculateDetailLevel = useCallback((barSpacing: number): string => {
    // TradingView's barSpacing roughly equals pixel width between candles
    if (barSpacing > 30) return '15m';  // Zoomed in - show detail
    if (barSpacing > 10) return '1h';   // Medium zoom
    return '4h';                        // Zoomed out - show overview
  }, []);

  const throttledFetch = useCallback(
    (() => {
      let timeoutId: number | null = null;
      return (params: { from: number; to: number; detailLevel: string }) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          fetchHierarchicalData(params);
        }, 100);
      };
    })(),
    []
  );

  const fetchHierarchicalData = async (params: { from: number; to: number; detailLevel: string }) => {
    const startTime = performance.now();
    setIsLoading(true);
    
    try {
      console.log(`[V2] Fetching ${params.detailLevel} data from ${new Date(params.from * 1000).toISOString()} to ${new Date(params.to * 1000).toISOString()}`);
      
      const data = await invoke<ChartData[]>('fetch_candles_v2', {
        request: {
          symbol: symbol,
          from: Math.floor(params.from),
          to: Math.floor(params.to),
          detail_level: params.detailLevel,
        }
      });

      const fetchTime = performance.now() - startTime;
      const renderStart = performance.now();

      if (!data || data.length === 0) {
        console.error('[V2] No data received');
        setDebugInfo(`[V2] No data for ${params.detailLevel}`);
        return;
      }

      const formattedData = data.map(candle => ({
        time: candle.time as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      // Debug: Check for duplicate timestamps
      const timeMap = new Map();
      formattedData.forEach((candle, index) => {
        if (timeMap.has(candle.time)) {
          console.error(`[V2] DUPLICATE TIMESTAMP at index ${index}: time=${candle.time}, prev at index ${timeMap.get(candle.time)}`);
        }
        timeMap.set(candle.time, index);
      });
      
      console.log(`[V2] Received ${data.length} candles, formatted ${formattedData.length}, unique times: ${timeMap.size}`);

      if (!seriesRef.current || !chartRef.current) {
        console.log('[V2] Chart disposed during data load');
        return;
      }

      // Update data without fitting content (preserve view)
      seriesRef.current.setData(formattedData);
      
      const renderTime = performance.now() - renderStart;
      const totalTime = performance.now() - startTime;
      
      // Update metrics and debug info
      const newMetrics: PerformanceMetrics = {
        fetchTime,
        renderTime,
        detailLevel: params.detailLevel,
        candleCount: data.length,
        barSpacing: chartRef.current.timeScale().options().barSpacing || 0
      };
      
      setMetrics(newMetrics);
      setCurrentDetailLevel(params.detailLevel);
      setDebugInfo(`[V2] ${params.detailLevel} • ${data.length} candles • ${totalTime.toFixed(0)}ms`);
      
      // Notify parent of detail level change
      if (onDetailLevelChange) {
        onDetailLevelChange(params.detailLevel);
      }
      
      console.log(`[V2 PERF] Total: ${totalTime.toFixed(0)}ms (fetch: ${fetchTime.toFixed(0)}ms, render: ${renderTime.toFixed(0)}ms)`);
      
    } catch (error) {
      console.error('[V2] Fetch error:', error);
      setDebugInfo(`[V2] Error: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVisibleRangeChange = useCallback((newRange: LogicalRange | null) => {
    if (!newRange || !chartRef.current) return;
    
    // Get the time range
    const timeRange = chartRef.current.timeScale().getVisibleRange();
    if (!timeRange) return;
    
    // Calculate optimal detail level based on bar spacing
    const barSpacing = chartRef.current.timeScale().options().barSpacing || 15;
    const detailLevel = calculateDetailLevel(barSpacing);
    
    console.log(`[V2] Range change: barSpacing=${barSpacing}, detailLevel=${detailLevel}`);
    
    // Only fetch if detail level changed or significant time range change
    if (detailLevel !== currentDetailLevel) {
      console.log(`[V2] Detail level changed: ${currentDetailLevel} -> ${detailLevel}`);
      throttledFetch({
        from: timeRange.from as number,
        to: timeRange.to as number,
        detailLevel: detailLevel
      });
    }
  }, [currentDetailLevel, calculateDetailLevel, throttledFetch]);

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
    
    // Set up range monitoring with the magic calculation
    handleVisibleRangeChangeRef.current = handleVisibleRangeChange;
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    console.log('[V2] Range change subscription created');
    
  
    // Load initial data
    loadInitialData();
  };

  const loadInitialData = async () => {
    // Load initial view with 1h detail level
    const from = 1704153600; // Jan 2, 2024
    const to = 1717200000;   // May 31, 2024
    
    await fetchHierarchicalData({
      from,
      to,
      detailLevel: '1h'
    });
    
    // Set initial view after data loads
    setTimeout(() => {
      if (chartRef.current && seriesRef.current) {
        const data = seriesRef.current.data();
        if (data.length > 100) {
          const endIndex = data.length - 1;
          const startIndex = Math.max(0, endIndex - 168); // Show last week
          
          chartRef.current.timeScale().setVisibleRange({
            from: (data[startIndex] as any).time,
            to: (data[endIndex] as any).time
          });
        }
      }
    }, 100);
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
      
      {/* Professional Debug Overlay */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#00ff88',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '11px',
        fontFamily: 'monospace',
        border: '1px solid #00ff88',
        maxWidth: '300px'
      }}>
        <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>
          {debugInfo}
        </div>
        {metrics && (
          <div style={{ fontSize: '10px', color: '#888' }}>
            Fetch: {metrics.fetchTime.toFixed(0)}ms • Render: {metrics.renderTime.toFixed(0)}ms • Spacing: {metrics.barSpacing.toFixed(1)}px
          </div>
        )}
      </div>
      
      {/* Loading indicator */}
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          color: '#00ff88',
          background: 'rgba(0, 0, 0, 0.8)',
          padding: '5px 10px',
          borderRadius: '4px',
          fontSize: '11px',
          fontFamily: 'monospace',
          border: '1px solid #00ff88'
        }}>
          Loading {currentDetailLevel}...
        </div>
      )}
    </div>
  );
};