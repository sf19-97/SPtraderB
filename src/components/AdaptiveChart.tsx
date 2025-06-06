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

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '12h'];
const MIN_CANDLE_WIDTH = 5;
const MAX_CANDLE_WIDTH = 30;

export const AdaptiveChart: React.FC = () => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const rangeSubscriptionRef = useRef<any>(null);
  
  // STATE MACHINE: Comprehensive chart state management
  const [chartState, setChartState] = useState({
    currentTimeframe: '1h',
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
    // Give flexbox time to calculate layout
    const timer = setTimeout(() => {
      if (chartContainerRef.current && !chartRef.current) {
        initializeChart();
      }
    }, 100);
    
    return () => {
      clearTimeout(timer);
      if (chartRef.current) {
        chartRef.current.remove();
      }
      // Clean up debug function
      window.debugChart = undefined;
    };
  }, []);

  const initializeChart = () => {
    console.log('Container dimensions:', {
      width: chartContainerRef.current!.clientWidth,
      height: chartContainerRef.current!.clientHeight
    });

    const chart = createChart(chartContainerRef.current!, {
      layout: {
        background: { color: '#1a1a1a' },
        textColor: '#ffffff',
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
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
        console.log('[DEBUG] Chart not initialized');
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

      // DEBUG: Track all range changes
      if (lastVisibleRange) {
        const barsDiff = Math.abs((range.to - range.from) - (lastVisibleRange.to - lastVisibleRange.from));
        const isPanning = barsDiff < 1; // Less than 1 bar difference means panning
        console.log(`[DEBUG] Range change: ${isPanning ? 'PANNING' : 'ZOOMING'} - bars: ${(range.to - range.from).toFixed(1)}`);
        
        // Check if we're at data boundaries
        const data = seriesRef.current?.data();
        if (data && data.length > 0 && isPanning) {
          if (range.from < 0) {
            console.log('[DEBUG] Hit LEFT boundary - no earlier data');
          }
          if (range.to > data.length) {
            console.log('[DEBUG] Hit RIGHT boundary - no later data');
          }
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

    const chartWidth = chartContainerRef.current!.clientWidth;
    const visibleBars = visibleRange.to - visibleRange.from;
    const candleWidth = chartWidth / visibleBars;
    
    // DEBUG: Zoom calculations
    console.log(`[DEBUG] Zoom check: ${visibleBars.toFixed(1)} bars visible, width=${chartWidth}px, candle width=${candleWidth.toFixed(2)}px`);
    console.log(`[DEBUG] Thresholds: MIN=${MIN_CANDLE_WIDTH}px, MAX=${MAX_CANDLE_WIDTH}px`);

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
        targetTimeframe = TIMEFRAMES[currentIndex - 1];
        console.log(`[DEBUG] Candles too wide (${candleWidth.toFixed(2)}px) - suggesting ${targetTimeframe}`);
      }
    }

    if (targetTimeframe !== chartState.currentTimeframe) {
      console.log(`[STATE] Requesting transition: ${chartState.currentTimeframe} -> ${targetTimeframe}`);
      
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
    
    // Calculate time range from visible logical range
    const data = seriesRef.current!.data();
    if (!data || data.length === 0) return;

    const fromIndex = Math.max(0, Math.floor(visibleRange.from));
    const toIndex = Math.min(data.length - 1, Math.ceil(visibleRange.to));
    
    // DEBUG: Index calculation
    console.log(`[DEBUG] Calculating time range from indices: ${fromIndex} to ${toIndex} (of ${data.length} candles)`);
    
    const fromTime = (data[fromIndex].time as number);
    const toTime = (data[toIndex].time as number);
    
    // DEBUG: Time range being requested
    console.log(`[DEBUG] Requesting data from: ${new Date(fromTime * 1000).toISOString()} to ${new Date(toTime * 1000).toISOString()}`);
    console.log(`[DEBUG] That's ${((toTime - fromTime) / 86400).toFixed(1)} days of data`);
    
    // For 5m candles, limit the range to prevent loading too many candles
    if (newTimeframe === '5m') {
      const maxDays = 7; // Max 1 week of 5m data (2016 candles)
      const requestedDays = (toTime - fromTime) / 86400;
      
      if (requestedDays > maxDays) {
        console.warn(`[DEBUG] Limiting 5m data request from ${requestedDays.toFixed(1)} days to ${maxDays} days`);
        const centerTime = (fromTime + toTime) / 2;
        const halfRange = (maxDays * 86400) / 2;
        await loadChartData(newTimeframe, { 
          from: centerTime - halfRange, 
          to: centerTime + halfRange 
        });
        return;
      }
    }

    // Load new timeframe data
    await loadChartData(newTimeframe, { from: fromTime, to: toTime });

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

  const loadChartData = async (timeframe: string, timeRange?: any) => {
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
      
      // For 5m timeframe without specific range, limit to last 7 days
      if (timeframe === '5m' && !timeRange) {
        console.log('[DEBUG] Limiting initial 5m load to last 7 days');
        to = 1717200000; // May 31, 2024
        from = to - (7 * 86400); // 7 days before
      }
      
      console.log(`[STATE] Loading data for timeframe: ${timeframe}`);
      console.log(`[DEBUG] Full data range available: 2024-01-02 to 2024-05-31 (~5 months)`);

      const data = await invoke<ChartData[]>('fetch_candles', {
        request: {
          symbol: 'EURUSD',
          timeframe,
          from: Math.floor(from),
          to: Math.floor(to),
        },
      });

      console.log('Received data:', data);
      
      // DEBUG: Request vs Response analysis
      console.log(`[DEBUG] Requested: ${new Date(from * 1000).toISOString()} to ${new Date(to * 1000).toISOString()}`);
      console.log(`[DEBUG] Requested range: ${((to - from) / 86400).toFixed(1)} days`);
      if (data && data.length > 0) {
        const firstDataTime = data[0].time as number;
        const lastDataTime = data[data.length-1].time as number;
        console.log(`[DEBUG] Received: ${data.length} candles from ${new Date(firstDataTime * 1000).toISOString()} to ${new Date(lastDataTime * 1000).toISOString()}`);
        
        // WARNING: Check for excessive data
        if (data.length > 1000) {
          console.warn(`[DEBUG] WARNING: Very large dataset (${data.length} candles) - chart performance may be impacted`);
          console.warn(`[DEBUG] Consider limiting the time range or using a higher timeframe`);
        } else if (data.length > 500) {
          console.warn(`[DEBUG] WARNING: Large dataset (${data.length} candles) may cause minor performance issues`);
        }
        
        // Expected candle counts for 5 months:
        // 5m: ~43,200 candles
        // 15m: ~14,400 candles  
        // 1h: ~3,600 candles
        // 4h: ~900 candles
        // 12h: ~300 candles
        console.log(`[DEBUG] Candle density: ${timeframe} timeframe with ${data.length} candles`);
      }

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

      seriesRef.current!.setData(formattedData);
      console.log('Series data count:', seriesRef.current!.data().length);
      
      // DEBUG: Data range analysis
      console.log(`[DEBUG] Chart data range: ${formattedData.length} candles`);
      if (formattedData.length > 0) {
        const firstTime = formattedData[0].time as number;
        const lastTime = formattedData[formattedData.length-1].time as number;
        console.log(`[DEBUG] Time range: ${new Date(firstTime * 1000).toISOString()} to ${new Date(lastTime * 1000).toISOString()}`);
      }
      
      // DEBUG: Visible vs total data
      const visibleRange = chartRef.current!.timeScale().getVisibleLogicalRange();
      if (visibleRange) {
        console.log(`[DEBUG] Visible bars: ${Math.round(visibleRange.to - visibleRange.from)} of ${formattedData.length} total`);
        console.log(`[DEBUG] Visible range indices: ${visibleRange.from.toFixed(2)} to ${visibleRange.to.toFixed(2)}`);
      }

      // Fit content to view
      const beforeRange = chartRef.current!.timeScale().getVisibleLogicalRange();
      console.log('[DEBUG] Before fitContent - visible range:', beforeRange ? `${beforeRange.from.toFixed(2)} to ${beforeRange.to.toFixed(2)}` : 'null');
      
      chartRef.current!.timeScale().fitContent();
      
      const afterRange = chartRef.current!.timeScale().getVisibleLogicalRange();
      console.log('[DEBUG] After fitContent - visible range:', afterRange ? `${afterRange.from.toFixed(2)} to ${afterRange.to.toFixed(2)}` : 'null');
      
      // For initial load, zoom to show a reasonable range based on timeframe
      if (!timeRange && formattedData.length > 100) {
        let visibleCandles = 100; // Default
        
        switch(timeframe) {
          case '5m':
            visibleCandles = 288; // 1 day
            break;
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
            visibleCandles = 60; // 1 month
            break;
        }
        
        const endIndex = formattedData.length - 1;
        const startIndex = Math.max(0, endIndex - visibleCandles);
        chartRef.current!.timeScale().setVisibleRange({
          from: formattedData[startIndex].time,
          to: formattedData[endIndex].time
        });
        console.log(`[DEBUG] Initial view: showing last ${visibleCandles} candles for ${timeframe} timeframe`);
      }
      
      // DEBUG: Check time scale boundaries
      const timeScale = chartRef.current!.timeScale();
      const timeVisibleRange = timeScale.getVisibleRange();
      if (timeVisibleRange) {
        console.log(`[DEBUG] Time scale visible range: ${new Date((timeVisibleRange.from as number) * 1000).toISOString()} to ${new Date((timeVisibleRange.to as number) * 1000).toISOString()}`);
      }
      console.log(`[DEBUG] Time scale scrollable: from=${timeScale.getVisibleLogicalRange()?.from.toFixed(2)} to=${timeScale.getVisibleLogicalRange()?.to.toFixed(2)}`);
      
      // STATE MACHINE: Update state with successful transition
      // Delay to prevent fitContent from triggering another transition
      setTimeout(() => {
        setChartState(prev => ({
          ...prev,
          currentTimeframe: timeframe,
          isTransitioning: false,
          pendingTimeframe: null
        }));
        console.log(`[STATE] Transition complete: now on ${timeframe}`);
      }, 300);
      
      // Preload adjacent timeframes
      preloadAdjacentTimeframes(timeframe, { from, to });
      
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
          symbol: 'EURUSD',
          timeframe: tf,
          from: Math.floor(timeRange.from),
          to: Math.floor(timeRange.to),
        },
      }).catch(() => {}); // Ignore errors for preloading
    });
  };

  return (
    <div className="chart-container" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="chart-controls" style={{ padding: '10px', background: '#1a1a1a' }}>
        <select 
          value={chartState.currentTimeframe} 
          onChange={(e) => {
            // STATE MACHINE: Block manual changes during transitions
            if (chartState.isTransitioning) {
              console.log('[STATE] Manual timeframe change blocked - transition in progress');
              e.preventDefault();
              return;
            }
            const newTimeframe = e.target.value;
            console.log(`[STATE] Manual timeframe change: ${chartState.currentTimeframe} -> ${newTimeframe}`);
            
            // DEBUG: Special logging for 5m
            if (newTimeframe === '5m') {
              console.log('[DEBUG] === 5M SELECTION DEBUG ===');
              console.log('[DEBUG] 5-minute data can be very large (~43k candles for 5 months)');
              console.log('[DEBUG] Loading full range initially, but zoom will be limited...');
            }
            
            loadChartData(newTimeframe);
          }}
          style={{ marginRight: '10px' }}
          disabled={chartState.isTransitioning}
        >
          {TIMEFRAMES.map(tf => (
            <option key={tf} value={tf}>{tf}</option>
          ))}
        </select>
        {isLoading && <span className="loading" style={{ color: '#fff' }}>Loading...</span>}
        <span style={{ color: '#fff', marginLeft: '20px' }}>
          Zoom with Ctrl+Scroll | Current: {chartState.currentTimeframe}
          {chartState.isTransitioning && ' (Transitioning...)'}
        </span>
      </div>
      <div 
        ref={chartContainerRef} 
        className="chart-canvas" 
        style={{ 
          flex: 1, 
          background: '#1a1a1a',
          minHeight: 'calc(100vh - 50px)' 
        }}
      />
    </div>
  );
};