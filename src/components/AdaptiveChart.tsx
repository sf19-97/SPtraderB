// src/components/AdaptiveChart.tsx
import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { invoke } from '@tauri-apps/api/core';

// Extend window for debug function
declare global {
  interface Window {
    debugChart?: () => void;
  }
}

interface ChartData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface AdaptiveChartProps {
  symbol?: string;
  timeframe?: string;
  onTimeframeChange?: (timeframe: string) => void;
}

const TIMEFRAMES = ['15m', '1h', '4h', '12h'];
const MIN_CANDLE_WIDTH = 5;
const MAX_CANDLE_WIDTH = 30;

export const AdaptiveChart: React.FC<AdaptiveChartProps> = ({ 
  symbol = 'EURUSD',
  timeframe = '1h',
  onTimeframeChange 
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const rangeSubscriptionRef = useRef<any>(null);
  
  // STATE MACHINE: Comprehensive chart state management
  const [chartState, setChartState] = useState({
    currentTimeframe: timeframe,
    isTransitioning: false,
    lastTransitionTime: 0,
    visibleRange: null as any,
    pendingTimeframe: null as string | null,
  });
  
  const chartStateRef = useRef(chartState);
  
  // Keep ref in sync with state
  useEffect(() => {
    chartStateRef.current = chartState;
  }, [chartState]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [crosshairPosition, setCrosshairPosition] = useState<any>(null);

  useEffect(() => {
    console.log('🟢 Chart effect starting');
    // Give flexbox time to calculate layout
    const timer = setTimeout(() => {
      if (chartContainerRef.current && !chartRef.current) {
        console.log('🟡 Initializing chart');
        initializeChart();
      }
    }, 100);
    
    return () => {
      console.log('🔴 Chart effect cleanup - destroying chart');
      clearTimeout(timer);
      if (rangeSubscriptionRef.current && typeof rangeSubscriptionRef.current === 'function') {
        console.log('🔴 Unsubscribing from range changes');
        rangeSubscriptionRef.current();
        rangeSubscriptionRef.current = null;
      }
      if (chartRef.current) {
        console.log('🔴 Removing chart instance');
        chartRef.current.remove();
        chartRef.current = null;
      }
      seriesRef.current = null;
      // Clean up debug function
      window.debugChart = undefined;
    };
  }, []);

  // Update timeframe when prop changes
  useEffect(() => {
    if (timeframe !== chartState.currentTimeframe && !chartState.isTransitioning) {
      loadChartData(timeframe);
    }
  }, [timeframe]);

  const initializeChart = () => {
    if (!chartContainerRef.current) return;

    console.log('Container dimensions:', {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight
    });

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

    // Use the new v5 API with addSeries
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
    
    // DEBUG: Expose debug function to window
    window.debugChart = () => {
      if (!chartRef.current || !seriesRef.current) {
        console.log('[DEBUG] Chart not initialized or disposed');
        return;
      }
      
      const data = seriesRef.current.data();
      const visibleLogicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
      const visibleTimeRange = chartRef.current.timeScale().getVisibleRange();
      
      console.log('[DEBUG] === CHART STATE ===');
      console.log('Current timeframe:', chartStateRef.current.currentTimeframe);
      console.log('Is transitioning:', chartStateRef.current.isTransitioning);
      console.log('Total data points:', data.length);
      console.log('Available data range: 2024-01-02 to 2024-05-31');
      
      if (data && data.length > 0) {
        console.log('Data time range:', new Date((data[0].time as number) * 1000).toISOString(), 'to', new Date((data[data.length-1].time as number) * 1000).toISOString());
      }
      
      if (visibleLogicalRange) {
        console.log('Visible logical range:', visibleLogicalRange.from.toFixed(2), 'to', visibleLogicalRange.to.toFixed(2));
        console.log('Visible bars:', (visibleLogicalRange.to - visibleLogicalRange.from).toFixed(1));
      }
      
      if (visibleTimeRange) {
        console.log('Visible time range:', new Date((visibleTimeRange.from as number) * 1000).toISOString(), 'to', new Date((visibleTimeRange.to as number) * 1000).toISOString());
      }
      
      console.log('Container width:', chartContainerRef.current?.clientWidth, 'px');
      console.log('==================');
    };

    // Set up adaptive zoom
    setupAdaptiveZoom(chart);
    
    // Load initial data
    loadChartData(chartState.currentTimeframe);
  };

  const setupAdaptiveZoom = (chart: IChartApi) => {
    let zoomTimeout: number | null = null;
    let lastVisibleRange: any = null;
    
    // Track crosshair for anchored zooming
    chart.subscribeCrosshairMove((param) => {
      if (param.time) {
        setCrosshairPosition({
          time: param.time,
          logical: param.logical,
        });
      }
    });

    // Create the range change handler
    const handleRangeChange = (range: any) => {
      if (!range) return;
      
      // GUARD: Check if chart is disposed
      if (!chartRef.current || !seriesRef.current) {
        console.log('[ERROR] Chart disposed during range change - ignoring');
        return;
      }

      // DEBUG: Track all range changes with actual candle count
      const timeScale = chartRef.current.timeScale();
      const visibleTimeRange = timeScale.getVisibleRange();
      
      if (visibleTimeRange && seriesRef.current) {
        const visibleData = seriesRef.current.data();
        let actualVisibleCandles = 0;
        
        for (const candle of visibleData) {
          const time = candle.time as number;
          if (time >= (visibleTimeRange.from as number) && time <= (visibleTimeRange.to as number)) {
            actualVisibleCandles++;
          }
        }
        
        if (lastVisibleRange) {
          const barsDiff = Math.abs((range.to - range.from) - (lastVisibleRange.to - lastVisibleRange.from));
          const isPanning = barsDiff < 1; // Less than 1 bar difference means panning
          console.log(`[DEBUG] Range change: ${isPanning ? 'PANNING' : 'ZOOMING'} - Logical bars: ${(range.to - range.from).toFixed(1)}, Actual candles: ${actualVisibleCandles}`);
        }
      }
      
      lastVisibleRange = { ...range };

      if (zoomTimeout) clearTimeout(zoomTimeout);
      
      zoomTimeout = setTimeout(() => {
        console.log('[STATE] Visible range changed, checking for timeframe switch');
        handleAdaptiveTimeframeSwitch(range);
      }, 200);
    };

    // Subscribe and store the subscription
    rangeSubscriptionRef.current = chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);
    console.log('[DEBUG] Range change subscription created');

    // Handle wheel events for smooth zooming
    const chartElement = chart.chartElement();
    chartElement.addEventListener('wheel', (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        handlePixelBasedZoom(event, chart);
      }
    });
  };

  const handleAdaptiveTimeframeSwitch = async (visibleRange: any) => {
    // GUARD: Check if chart is disposed
    if (!chartRef.current || !seriesRef.current) {
      console.log('[ERROR] Chart or series disposed - aborting');
      return;
    }

    // STATE MACHINE: Block if already transitioning
    if (chartState.isTransitioning) {
      console.log('[STATE] Transition blocked - already in progress');
      return;
    }

    // STATE MACHINE: Enforce minimum time between transitions
    const now = Date.now();
    if (now - chartState.lastTransitionTime < 500) {
      console.log('[STATE] Transition blocked - too soon after last transition');
      return;
    }

    // CRITICAL FIX: Use time range, not logical range
    const timeScale = chartRef.current.timeScale();
    const visibleTimeRange = timeScale.getVisibleRange();
    
    if (!visibleTimeRange) {
      console.log('[ERROR] No visible time range available');
      return;
    }

    // Count ACTUAL visible candles on screen
    const visibleData = seriesRef.current!.data();
    let actualVisibleCandles = 0;
    
    for (const candle of visibleData) {
      const time = candle.time as number;
      if (time >= (visibleTimeRange.from as number) && time <= (visibleTimeRange.to as number)) {
        actualVisibleCandles++;
      }
    }
    
    if (actualVisibleCandles === 0) {
      console.log('[ERROR] No visible candles found in time range');
      return;
    }
    
    const chartWidth = chartContainerRef.current!.clientWidth;
    const candleWidth = chartWidth / actualVisibleCandles;
    
    // Enhanced debug logging
    console.log(`[FIX] Time range: ${new Date((visibleTimeRange.from as number) * 1000).toISOString()} to ${new Date((visibleTimeRange.to as number) * 1000).toISOString()}`);
    console.log(`[FIX] Actual visible candles: ${actualVisibleCandles}`);
    console.log(`[FIX] Candle width: ${candleWidth.toFixed(2)}px`);
    console.log(`[FIX] Chart width: ${chartWidth}px`);
    console.log(`[FIX] Thresholds: MIN=${MIN_CANDLE_WIDTH}px, MAX=${MAX_CANDLE_WIDTH}px`);

    // Determine optimal timeframe based on candle width
    let targetTimeframe = chartState.currentTimeframe;
    
    if (candleWidth < MIN_CANDLE_WIDTH) {
      // Too zoomed out - switch to higher timeframe
      const currentIndex = TIMEFRAMES.indexOf(chartState.currentTimeframe);
      if (currentIndex < TIMEFRAMES.length - 1) {
        targetTimeframe = TIMEFRAMES[currentIndex + 1];
        console.log(`[DEBUG] Candles too thin (${candleWidth.toFixed(2)}px) - suggesting ${targetTimeframe}`);
      }
    } else if (candleWidth > MAX_CANDLE_WIDTH) {
      // Too zoomed in - switch to lower timeframe
      const currentIndex = TIMEFRAMES.indexOf(chartState.currentTimeframe);
      if (currentIndex > 0) {
        // SPECIAL CASE: Don't switch away from 12h for wide candles
        if (chartState.currentTimeframe === '12h') {
          console.log(`[DEBUG] 12h candles are wide (${candleWidth.toFixed(2)}px) but keeping 12h - it's the highest timeframe`);
        } else {
          targetTimeframe = TIMEFRAMES[currentIndex - 1];
          console.log(`[DEBUG] Candles too wide (${candleWidth.toFixed(2)}px) - suggesting ${targetTimeframe}`);
        }
      }
    }

    if (targetTimeframe !== chartState.currentTimeframe) {
      console.log(`[STATE] Requesting transition: ${chartState.currentTimeframe} -> ${targetTimeframe}`);
      
      // Notify parent component if handler provided
      if (onTimeframeChange) {
        onTimeframeChange(targetTimeframe);
      }
      
      // STATE MACHINE: Update state to indicate pending transition
      setChartState(prev => ({
        ...prev,
        pendingTimeframe: targetTimeframe,
        visibleRange: visibleRange
      }));
      
      await transitionToTimeframe(targetTimeframe, visibleRange);
    }
  };

  const transitionToTimeframe = async (newTimeframe: string, visibleRange: any) => {
    console.log(`[STATE] Starting transition to ${newTimeframe}`);
    
    // FUCK THE VISIBLE RANGE - LOAD ALL THE DATA
    console.log(`[FIX] Loading FULL dataset for ${newTimeframe}, not just visible range`);

    // Load new timeframe data with FULL range
    await loadChartData(newTimeframe);

    // Animate the transition
    animateTimeframeChange();
  };

  const animateTimeframeChange = () => {
    if (!chartRef.current) return;

    // Add a fade effect during transition
    const chartElement = chartRef.current.chartElement();
    chartElement.style.transition = 'opacity 150ms ease-in-out';
    chartElement.style.opacity = '0.7';

    setTimeout(() => {
      chartElement.style.opacity = '1';
    }, 150);
  };

  const handlePixelBasedZoom = (event: WheelEvent, chart: IChartApi) => {
    // GUARD: Check if chart is disposed
    if (!chart || !chartRef.current) {
      console.log('[ERROR] Chart disposed during zoom - aborting');
      return;
    }
    
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const timeScale = chart.timeScale();
    const currentRange = timeScale.getVisibleLogicalRange();
    
    if (!currentRange || !crosshairPosition) return;

    // Calculate new range anchored to crosshair
    const rangeDiff = currentRange.to - currentRange.from;
    const newRangeDiff = rangeDiff * zoomFactor;
    
    const leftRatio = (crosshairPosition.logical - currentRange.from) / rangeDiff;
    const rightRatio = (currentRange.to - crosshairPosition.logical) / rangeDiff;
    
    const newRange = {
      from: crosshairPosition.logical - (newRangeDiff * leftRatio),
      to: crosshairPosition.logical + (newRangeDiff * rightRatio),
    };

    timeScale.setVisibleLogicalRange(newRange);
  };

  const loadChartData = async (newTimeframe: string, timeRange?: any) => {
    // STATE MACHINE: Set transitioning flag
    setChartState(prev => ({
      ...prev,
      isTransitioning: true,
      lastTransitionTime: Date.now()
    }));
    setIsLoading(true);
    
    try {
      // Updated data range: Jan 2, 2024 to May 31, 2024
      let from = timeRange?.from || 1704153600; // Jan 2, 2024 00:00:00
      let to = timeRange?.to || 1717200000; // May 31, 2024 23:59:59
      
      console.log(`[STATE] Loading data for timeframe: ${newTimeframe}`);
      console.log(`[DEBUG] Full data range available: 2024-01-02 to 2024-05-31 (~5 months)`);

      const data = await invoke<ChartData[]>('fetch_candles', {
        request: {
          symbol: symbol,
          timeframe: newTimeframe,
          from: Math.floor(from),
          to: Math.floor(to),
        },
      });

      console.log('Received data:', data);
      
      if (!data || data.length === 0) {
        console.error('No data received');
        // STATE MACHINE: Clear transition state on error
        setTimeout(() => {
          setChartState(prev => ({
            ...prev,
            isTransitioning: false,
            pendingTimeframe: null
          }));
        }, 300);
        return;
      }

      const formattedData = data.map(candle => ({
        time: candle.time as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      console.log('Formatted data:', formattedData);

      // GUARD: Check if chart is still alive before setting data
      if (!seriesRef.current || !chartRef.current) {
        console.log('[ERROR] Chart disposed during data load - aborting');
        return;
      }

      seriesRef.current.setData(formattedData);
      console.log('Series data count:', seriesRef.current.data().length);
      
      // DO NOT USE fitContent() - it triggers oscillation
      // chartRef.current.timeScale().fitContent();
      
      // For initial load, zoom to show a reasonable range based on timeframe
      if (!timeRange && formattedData.length > 100) {
        let visibleCandles = 100; // Default
        
        switch(newTimeframe) {
          case '15m':
            visibleCandles = 192; // 2 days
            break;
          case '1h':
            visibleCandles = 168; // 1 week
            break;
          case '4h':
            visibleCandles = 84; // 2 weeks
            break;
          case '12h':
            visibleCandles = 120; // 2 months - more candles to prevent "too wide" trigger
            break;
        }
        
        const endIndex = formattedData.length - 1;
        const startIndex = Math.max(0, endIndex - visibleCandles);
        
        // GUARD: Check chart is still alive before setting range
        if (chartRef.current) {
          chartRef.current.timeScale().setVisibleRange({
            from: formattedData[startIndex].time,
            to: formattedData[endIndex].time
          });
          console.log(`[DEBUG] Initial view: showing last ${visibleCandles} candles for ${newTimeframe} timeframe`);
        }
      }
      
      // STATE MACHINE: Update state with successful transition
      // Delay to prevent fitContent from triggering another transition
      setTimeout(() => {
        setChartState(prev => ({
          ...prev,
          currentTimeframe: newTimeframe,
          isTransitioning: false,
          pendingTimeframe: null
        }));
        console.log(`[STATE] Transition complete: now on ${newTimeframe}`);
      }, 300);
      
      // Preload adjacent timeframes
      preloadAdjacentTimeframes(newTimeframe, { from, to });
      
    } catch (error) {
      console.error('Failed to load chart data:', error);
      // STATE MACHINE: Clear transition state on error
      setTimeout(() => {
        setChartState(prev => ({
          ...prev,
          isTransitioning: false,
          pendingTimeframe: null
        }));
      }, 300);
    } finally {
      setIsLoading(false);
    }
  };

  const preloadAdjacentTimeframes = async (currentTf: string, timeRange: any) => {
    // Don't preload during active transitions
    if (chartState.isTransitioning) {
      console.log('[STATE] Skipping preload - transition in progress');
      return;
    }
    
    const currentIndex = TIMEFRAMES.indexOf(currentTf);
    const adjacent = [
      TIMEFRAMES[currentIndex - 1],
      TIMEFRAMES[currentIndex + 1],
    ].filter(Boolean);

    console.log(`[STATE] Preloading adjacent timeframes for ${currentTf}:`, adjacent);

    // Preload in background
    adjacent.forEach(tf => {
      invoke('fetch_candles', {
        request: {
          symbol: symbol,
          timeframe: tf,
          from: Math.floor(timeRange.from),
          to: Math.floor(timeRange.to),
        },
      }).catch(() => {}); // Ignore errors for preloading
    });
  };

  return (
    <div 
      ref={chartContainerRef} 
      style={{ 
        width: '100%',
        height: '100%',
        background: '#0a0a0a',
        position: 'relative'
      }}
    >
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
          Loading...
        </div>
      )}
    </div>
  );
};