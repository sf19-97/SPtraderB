import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { invoke } from '@tauri-apps/api/core';
import { useChartStore } from '../stores/useChartStore';

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

interface SymbolMetadata {
  symbol: string;
  start_timestamp: number;
  end_timestamp: number;
  has_data: boolean;
}

const AdaptiveChart: React.FC<AdaptiveChartProps> = ({ 
  symbol = 'EURUSD',
  timeframe,
  onTimeframeChange 
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  
  const [currentTimeframe, setCurrentTimeframe] = useState(timeframe || '1h');
  const currentTimeframeRef = useRef(timeframe || '1h'); // for logic tracking
  const symbolRef = useRef(symbol); // Track current symbol to avoid closure issues
  const [isLoading, setIsLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [chartOpacity, setChartOpacity] = useState(1);
  
  // Zustand store
  const { 
    getCachedCandles, 
    setCachedCandles, 
    getCacheKey,
    saveViewState,
    getViewState,
    setCurrentSymbol,
    setCurrentTimeframe: setStoreTimeframe,
    getCachedMetadata,
    setCachedMetadata
  } = useChartStore();
  
  // Transition cooldown tracking
  const lastTransitionRef = useRef<number>(0);
  const TRANSITION_COOLDOWN = 700; // Increased to match longer animation
  
  // Left edge locking
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const lockedLeftEdgeRef = useRef<number | null>(null);
  
  // Interval tracking
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Track if initial load has been done
  const initialLoadDoneRef = useRef(false);
  
  // CRITICAL: Use bar spacing thresholds, not pixel widths
  const SWITCH_TO_15M_BAR_SPACING = 32;  // When 1h bars are spread this wide, switch to 15m
  const SWITCH_TO_1H_BAR_SPACING = 8;    // When 15m bars are squeezed this tight, switch to 1h
  const SWITCH_TO_4H_BAR_SPACING = 8;    // When 1h bars are squeezed this tight, switch to 4h
  const SWITCH_FROM_4H_BAR_SPACING = 32; // When 4h bars are spread this wide, switch to 1h
  const SWITCH_TO_12H_BAR_SPACING = 4;   // When 4h bars are squeezed this tight, switch to 12h
  const SWITCH_FROM_12H_BAR_SPACING = 24; // When 12h bars are spread this wide, switch to 4h (3x factor)


  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Initialize chart
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
        mode: 0, // Normal mode - shows both crosshair lines
        vertLine: {
          color: '#758696',
          width: 1,
          style: 3, // Dashed
          labelBackgroundColor: '#2B2B43',
        },
        horzLine: {
          color: '#758696',
          width: 1,
          style: 3, // Dashed
          labelBackgroundColor: '#2B2B43',
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 12, // Default bar spacing
        minBarSpacing: 2, // Prevent excessive zoom out
        rightOffset: 5,   // Small margin on the right
        rightBarStaysOnScroll: true, // Keep the latest bar in view when scrolling
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88',
      downColor: '#ff4976',
      borderVisible: false,
      wickUpColor: '#00ff88',
      wickDownColor: '#ff4976',
      priceFormat: {
        type: 'price',
        precision: 5,  // Default precision, will be updated based on symbol
        minMove: 0.00001,
      },
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;


    // Handle resize
    const handleResize = () => {
      chart.applyOptions({
        width: chartContainerRef.current!.clientWidth,
        height: chartContainerRef.current!.clientHeight
      });
    };
    window.addEventListener('resize', handleResize);

    // CRITICAL: Monitor BAR SPACING changes instead of pixel widths
    let lastBarSpacing = 13;
    
    checkIntervalRef.current = setInterval(() => {
      if (!isTransitioning && chartRef.current) {
        try {
          const currentBarSpacing = chartRef.current.timeScale().options().barSpacing;
          
          if (currentBarSpacing !== lastBarSpacing) {
            console.log(`[ResolutionTracker] Current timeframe: ${currentTimeframeRef.current}, bar spacing: ${currentBarSpacing}`);
            lastBarSpacing = currentBarSpacing;
            checkTimeframeSwitch(currentBarSpacing);
          }
        } catch (e) {
          // Chart might be disposed, clear interval
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current);
            checkIntervalRef.current = null;
          }
        }
      }
    }, 100); // Check every 100ms


    // Keyboard event handlers for left edge locking
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !isShiftPressed) {
        setIsShiftPressed(true);
        // Lock the current left edge and unlock right
        const visibleRange = chartRef.current?.timeScale().getVisibleRange();
        if (visibleRange) {
          lockedLeftEdgeRef.current = visibleRange.from as number;
          console.log('[LOCK LEFT] Locked at:', new Date((visibleRange.from as number) * 1000).toISOString());
        }
        // Disable rightBarStaysOnScroll
        chartRef.current?.timeScale().applyOptions({
          rightBarStaysOnScroll: false
        });
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(false);
        lockedLeftEdgeRef.current = null;
        console.log('[LOCK LEFT] Released, re-enabling right lock');
        // Re-enable rightBarStaysOnScroll
        chartRef.current?.timeScale().applyOptions({
          rightBarStaysOnScroll: true
        });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (chart) {
        chart.remove();
      }
    };
  }, []); // Only create chart once

  // Initial load - only once when component mounts
  useEffect(() => {
    if (initialLoadDoneRef.current) {
      console.log('[AdaptiveChart] Initial load already done, skipping');
      return;
    }
    
    let mounted = true;
    const loadInitialData = async () => {
      if (!mounted || initialLoadDoneRef.current) return;
      
      console.log('[AdaptiveChart] Initial load triggered');
      initialLoadDoneRef.current = true;
      
      // Update store with initial timeframe
      setStoreTimeframe(currentTimeframeRef.current);
      await loadData(currentTimeframeRef.current);
    };
    
    loadInitialData();
    return () => { mounted = false; };
  }, []); // Empty deps - only run once on mount

  // Handle external timeframe changes from buttons
  useEffect(() => {
    if (timeframe && timeframe !== currentTimeframeRef.current && !isTransitioning) {
      console.log(`[EXTERNAL] Switching to ${timeframe} from button`);
      switchTimeframe(timeframe);
    }
  }, [timeframe]);

  // Update symbol ref when symbol changes - combine both effects
  useEffect(() => {
    if (!symbol) return;
    
    const prevSymbol = symbolRef.current;
    symbolRef.current = symbol;
    setCurrentSymbol(symbol); // Update Zustand store
    
    // Only reload if symbol actually changed AND initial load is done
    if (prevSymbol !== symbol && chartRef.current && initialLoadDoneRef.current && prevSymbol !== undefined) {
      console.log('[AdaptiveChart] Symbol changed from', prevSymbol, 'to', symbol);
      
      // Clear existing chart data immediately when symbol changes
      if (seriesRef.current) {
        console.log('[AdaptiveChart] Clearing chart data for symbol change');
        seriesRef.current.setData([]);
      }
      
      console.log('[AdaptiveChart] Reloading data for new symbol:', symbol, 'with timeframe:', currentTimeframeRef.current);
      loadData(currentTimeframeRef.current);
    }
  }, [symbol, setCurrentSymbol]);

  // Debug log for current state - tracks actual timeframe changes
  useEffect(() => {
    console.log('[AdaptiveChart] Current state - Symbol:', symbol, 'Actual Timeframe:', currentTimeframeRef.current);
  }, [symbol, currentTimeframe]);
  
  // Function to get date range for current symbol
  const getSymbolDateRange = async (): Promise<{ from: number; to: number }> => {
    const currentSymbol = symbolRef.current;
    
    // Check Zustand cache first
    const cachedMetadata = getCachedMetadata(currentSymbol);
    if (cachedMetadata) {
      console.log('[AdaptiveChart] Using cached metadata for:', currentSymbol);
      return cachedMetadata;
    }
    
    try {
      const startTime = performance.now();
      const metadata = await invoke<SymbolMetadata>('get_symbol_metadata', { symbol: currentSymbol });
      const fetchTime = performance.now() - startTime;
      console.log(`[AdaptiveChart] Symbol metadata fetched in ${fetchTime.toFixed(0)}ms:`, metadata);
      
      if (metadata.has_data) {
        const range = {
          from: metadata.start_timestamp,
          to: metadata.end_timestamp
        };
        // Cache in Zustand
        setCachedMetadata(currentSymbol, range.from, range.to);
        return range;
      }
    } catch (error) {
      console.error('[AdaptiveChart] Failed to fetch symbol metadata:', error);
    }
    
    // Fallback to default range
    const defaultRange = {
      from: 1673060400, // Jan 7, 2023
      to: 1750229999,   // June 2025 (updated to match your data)
    };
    setCachedMetadata(currentSymbol, defaultRange.from, defaultRange.to);
    return defaultRange;
  };

  const loadHistoricalData = async (timeframe: string, from: number, to: number) => {
    try {
      // Fetch the historical data
      const historicalData = await invoke<ChartData[]>('fetch_candles', {
        request: {
          symbol: symbolRef.current,
          timeframe: timeframe,
          from: from,
          to: to,
        },
      });

      if (!historicalData || !seriesRef.current || historicalData.length === 0) return;

      // Format the historical data
      const formattedHistorical = historicalData.map(candle => ({
        time: candle.time as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      // Get current data from the series
      const currentData = seriesRef.current.data();
      
      // Combine historical and current data
      const combinedData = [...formattedHistorical, ...currentData];
      
      // Sort by time to ensure correct order
      combinedData.sort((a, b) => a.time - b.time);
      
      // Remove duplicates by keeping only unique timestamps
      const uniqueData = combinedData.filter((candle, index, array) => {
        // Keep if it's the first element or if its time is different from the previous
        return index === 0 || candle.time !== array[index - 1].time;
      });
      
      // Update the chart with combined data
      seriesRef.current.setData(uniqueData); // Set all data at once
      
      console.log(`[AdaptiveChart] Background load complete: added ${formattedHistorical.length} historical candles, ${uniqueData.length} total after deduplication`);
    } catch (error) {
      console.error('[AdaptiveChart] Failed to load historical data:', error);
      // Non-fatal - user can still interact with recent data
    }
  };

  const checkTimeframeSwitch = (barSpacing: number) => {
    if (isTransitioning) {
      console.log('[ResolutionTracker] Skipping timeframe check - transition in progress');
      return;
    }

    const currentTf = currentTimeframeRef.current;
    console.log('[ResolutionTracker] Checking timeframe switch - Current:', currentTf, 'Bar spacing:', barSpacing);
    
    // Enforce minimum bar spacing for 12h to prevent excessive zoom out
    if (currentTf === '12h' && barSpacing < 3) {
      console.log('[ZOOM LIMIT] Enforcing minimum bar spacing for 12h');
      chartRef.current?.timeScale().applyOptions({
        barSpacing: 3
      });
      return;
    }
    
    // 12h → 4h (zooming in)
    if (currentTf === '12h' && barSpacing > SWITCH_FROM_12H_BAR_SPACING) {
      console.log(`[SWITCH] 12h bar spacing ${barSpacing} > ${SWITCH_FROM_12H_BAR_SPACING} → switching to 4h`);
      switchTimeframe('4h');
    }
    // 4h → 12h (zooming out)
    else if (currentTf === '4h' && barSpacing < SWITCH_TO_12H_BAR_SPACING) {
      console.log(`[SWITCH] 4h bar spacing ${barSpacing} < ${SWITCH_TO_12H_BAR_SPACING} → switching to 12h`);
      switchTimeframe('12h');
    }
    // 4h → 1h (zooming in)
    else if (currentTf === '4h' && barSpacing > SWITCH_FROM_4H_BAR_SPACING) {
      console.log(`[SWITCH] 4h bar spacing ${barSpacing} > ${SWITCH_FROM_4H_BAR_SPACING} → switching to 1h`);
      switchTimeframe('1h');
    }
    // 1h → 4h (zooming out)
    else if (currentTf === '1h' && barSpacing < SWITCH_TO_4H_BAR_SPACING) {
      console.log(`[SWITCH] 1h bar spacing ${barSpacing} < ${SWITCH_TO_4H_BAR_SPACING} → switching to 4h`);
      switchTimeframe('4h');
    }
    // 1h → 15m (zooming in)
    else if (currentTf === '1h' && barSpacing > SWITCH_TO_15M_BAR_SPACING) {
      console.log(`[SWITCH] 1h bar spacing ${barSpacing} > ${SWITCH_TO_15M_BAR_SPACING} → switching to 15m`);
      switchTimeframe('15m');
    }
    // 15m → 1h (zooming out)
    else if (currentTf === '15m' && barSpacing < SWITCH_TO_1H_BAR_SPACING) {
      console.log(`[SWITCH] 15m bar spacing ${barSpacing} < ${SWITCH_TO_1H_BAR_SPACING} → switching to 1h`);
      switchTimeframe('1h');
    }
  };

  const switchTimeframe = async (newTimeframe: string) => {
    if (newTimeframe === currentTimeframeRef.current || isTransitioning) return;
    
    console.log('[ResolutionTracker] Timeframe transition:', currentTimeframeRef.current, '→', newTimeframe);
    
    // Check cooldown
    const now = Date.now();
    if (now - lastTransitionRef.current < TRANSITION_COOLDOWN) {
      console.log('[COOLDOWN] Too fast! Wait a bit...');
      return; // Silent "fuckoff" response
    }
    
    lastTransitionRef.current = now;
    setIsTransitioning(true);
    
    // Store current view before switching
    const timeScale = chartRef.current!.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    const currentBarSpacing = timeScale.options().barSpacing;
    const previousTimeframe = currentTimeframeRef.current; // Store this BEFORE updating
    
    console.log(`[ResolutionTracker] Executing transition: ${previousTimeframe} → ${newTimeframe} at bar spacing ${currentBarSpacing}`);
    
    currentTimeframeRef.current = newTimeframe;
    setCurrentTimeframe(newTimeframe);
    setStoreTimeframe(newTimeframe); // Update Zustand store
    if (onTimeframeChange) {
      onTimeframeChange(newTimeframe);
    }
    
    await loadDataAndMaintainView(newTimeframe, visibleRange, currentBarSpacing, previousTimeframe);
    
    setIsTransitioning(false);
  };

  const loadData = async (timeframe: string) => {
    console.log('[AdaptiveChart] loadData called for symbol:', symbolRef.current, 'timeframe:', timeframe);
    
    // Prevent concurrent loads
    if (isLoading) {
      console.log('[AdaptiveChart] Already loading, skipping duplicate request');
      return;
    }
    
    // Skip loading if document is hidden (prevents display ID issues)
    if (document.hidden) {
      console.log('[AdaptiveChart] Document is hidden, skipping load');
      return;
    }
    
    const startTime = performance.now();
    setIsLoading(true);
    
    try {
      // Get date range for current symbol
      const dateRange = await getSymbolDateRange();
      const metadataTime = performance.now();
      console.log('[AdaptiveChart] Full date range:', new Date(dateRange.from * 1000).toISOString(), 'to', new Date(dateRange.to * 1000).toISOString());
      console.log(`[TIMING] Metadata fetch: ${(metadataTime - startTime).toFixed(0)}ms`);
      
      // Calculate 3 months ago for initial load - round to start of day for stable cache key
      const todayStartTimestamp = Math.floor(Date.now() / 1000 / 86400) * 86400;
      const threeMonthsAgo = todayStartTimestamp - (90 * 24 * 60 * 60);
      const initialFrom = Math.max(dateRange.from, threeMonthsAgo);
      
      console.log('[AdaptiveChart] Initial load range:', new Date(initialFrom * 1000).toISOString(), 'to', new Date(dateRange.to * 1000).toISOString());
      
      // Check frontend cache first
      const cacheKey = getCacheKey(symbolRef.current, timeframe, initialFrom, dateRange.to);
      console.log('[AdaptiveChart] Cache key:', cacheKey, {
        symbol: symbolRef.current,
        timeframe,
        from: new Date(initialFrom * 1000).toISOString(),
        to: new Date(dateRange.to * 1000).toISOString()
      });
      let data = getCachedCandles(cacheKey);
      
      let dataFetchTime = performance.now();
      
      if (data) {
        console.log(`[TIMING] Frontend cache hit! Skipping API call`);
      } else {
        // Phase 1: Load last 3 months for immediate display
        const fetchStartTime = performance.now();
        data = await invoke<ChartData[]>('fetch_candles', {
          request: {
            symbol: symbolRef.current,
            timeframe: timeframe,
            from: initialFrom,
            to: dateRange.to,
          },
        });

        dataFetchTime = performance.now();
        console.log(`[TIMING] Candle fetch: ${(dataFetchTime - fetchStartTime).toFixed(0)}ms`);
        
        // Cache the data
        if (data && data.length > 0) {
          setCachedCandles(cacheKey, data);
        }
      }

      if (!data || !seriesRef.current) return;

      const formattedData = data.map(candle => ({
        time: candle.time as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      seriesRef.current.setData(formattedData);
      
      const renderTime = performance.now();
      console.log(`[TIMING] Chart render: ${(renderTime - dataFetchTime).toFixed(0)}ms`);
      
      // Phase 2: Load historical data in background if needed
      if (initialFrom > dateRange.from) {
        console.log('[AdaptiveChart] Loading historical data in background...');
        loadHistoricalData(timeframe, dateRange.from, initialFrom);
      }
      
      // Log data bounds
      if (formattedData.length > 0) {
        const firstCandle = formattedData[0].time;
        const lastCandle = formattedData[formattedData.length - 1].time;
        console.log(`[DATA BOUNDS] ${new Date(firstCandle * 1000).toISOString()} to ${new Date(lastCandle * 1000).toISOString()}`);
      }
      
      // Show appropriate default view based on timeframe
      if (chartRef.current && formattedData.length > 0) {
        let daysToShow = 7; // Default for 1h
        
        if (timeframe === '15m') daysToShow = 2;
        else if (timeframe === '1h') daysToShow = 7;
        else if (timeframe === '4h') daysToShow = 30;
        else if (timeframe === '12h') daysToShow = 60;
        
        const timeRange = daysToShow * 24 * 60 * 60;
        const endTime = formattedData[formattedData.length - 1].time;
        const startTime = endTime - timeRange;
        const startIndex = formattedData.findIndex(d => d.time >= startTime);
        
        if (startIndex > 0) {
          chartRef.current.timeScale().setVisibleRange({
            from: formattedData[startIndex].time,
            to: formattedData[formattedData.length - 1].time
          });
        }
      }
      
      console.log(`[ResolutionTracker] Loaded ${timeframe}: ${data.length} candles`);
      
      const totalTime = performance.now() - startTime;
      console.log(`[TIMING] TOTAL LOAD TIME: ${totalTime.toFixed(0)}ms (${(totalTime/1000).toFixed(1)}s)`);
      
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDataAndMaintainView = async (timeframe: string, visibleRange: any, previousBarSpacing: number, previousTimeframe: string) => {
    console.log('[AdaptiveChart] loadDataAndMaintainView called for symbol:', symbolRef.current, 'timeframe:', timeframe);
    
    setIsLoading(true);
    
    // Start fade out animation
    setChartOpacity(0.2);
    
    // Longer delay for fade out to be visible
    await new Promise(resolve => setTimeout(resolve, 250));
    
    try {
      // Get date range for current symbol
      const dateRange = await getSymbolDateRange();
      
      // For timeframe switches, we can load full range since user is actively using the chart
      // This maintains view continuity during zoom transitions
      const data = await invoke<ChartData[]>('fetch_candles', {
        request: {
          symbol: symbolRef.current,
          timeframe: timeframe,
          from: dateRange.from,
          to: dateRange.to,
        },
      });

      if (!data || !seriesRef.current || !chartRef.current) return;

      const formattedData = data.map(candle => ({
        time: candle.time as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      // Calculate new bar spacing BEFORE setting data
      let newBarSpacing = previousBarSpacing;
      
      if (timeframe === '15m' && previousTimeframe === '1h') {
        // Going from 1h to 15m: reduce bar spacing to fit 4x more candles
        newBarSpacing = Math.max(3, previousBarSpacing / 4);
      } else if (timeframe === '1h' && previousTimeframe === '15m') {
        // Going from 15m to 1h: increase bar spacing since we have 4x fewer candles
        newBarSpacing = Math.min(50, previousBarSpacing * 4);
      } else if (timeframe === '1h' && previousTimeframe === '4h') {
        // Going from 4h to 1h: reduce bar spacing to fit 4x more candles
        newBarSpacing = Math.max(3, previousBarSpacing / 4);
      } else if (timeframe === '4h' && previousTimeframe === '1h') {
        // Going from 1h to 4h: increase bar spacing since we have 4x fewer candles
        newBarSpacing = Math.min(50, previousBarSpacing * 4);
      } else if (timeframe === '4h' && previousTimeframe === '12h') {
        // Going from 12h to 4h: reduce bar spacing to fit 3x more candles
        newBarSpacing = Math.max(3, previousBarSpacing / 3);
      } else if (timeframe === '12h' && previousTimeframe === '4h') {
        // Going from 4h to 12h: increase bar spacing since we have 3x fewer candles
        newBarSpacing = Math.min(50, previousBarSpacing * 3);
      }
      
      console.log(`[SPACING] Pre-adjusting bar spacing: ${previousBarSpacing} → ${newBarSpacing}`);
      
      // Apply bar spacing BEFORE setting data
      chartRef.current.timeScale().applyOptions({
        barSpacing: newBarSpacing
      });
      
      // NOW set the data with the correct bar spacing already applied
      seriesRef.current.setData(formattedData);
      
      
      // Set the visible range immediately after data
      if (visibleRange) {
        if (isShiftPressed && lockedLeftEdgeRef.current !== null) {
          // Keep left edge locked, only adjust right edge based on duration
          const currentDuration = visibleRange.to - visibleRange.from;
          const ratio = timeframe === previousTimeframe ? 1 : 
            (timeframe === '15m' && previousTimeframe === '1h') ? 4 :
            (timeframe === '1h' && previousTimeframe === '15m') ? 0.25 :
            (timeframe === '1h' && previousTimeframe === '4h') ? 4 :
            (timeframe === '4h' && previousTimeframe === '1h') ? 0.25 :
            (timeframe === '4h' && previousTimeframe === '12h') ? 3 :
            (timeframe === '12h' && previousTimeframe === '4h') ? 0.33 : 1;
          
          const newDuration = currentDuration / ratio;
          const newTo = lockedLeftEdgeRef.current + newDuration;
          
          chartRef.current.timeScale().setVisibleRange({
            from: lockedLeftEdgeRef.current as any,
            to: newTo as any
          });
          
          console.log('[LOCK LEFT] Maintaining locked left edge during transition');
        } else {
          // Normal behavior
          chartRef.current.timeScale().setVisibleRange({
            from: visibleRange.from as any,
            to: visibleRange.to as any
          });
        }
      }
      
      console.log(`[ResolutionTracker] Loaded ${timeframe}: ${data.length} candles (maintained view)`);
      
      // Fade back in
      setChartOpacity(1);
      
    } catch (error) {
      console.error('Failed to load data:', error);
      setChartOpacity(1); // Ensure we fade back in even on error
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      ref={chartContainerRef} 
      style={{ 
        width: '100%',
        height: '100%',
        background: '#0a0a0a',
        position: 'relative',
        opacity: chartOpacity,
        transition: 'opacity 300ms ease-in-out'
      }}
    >
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          padding: '5px 10px',
          borderRadius: '4px',
          fontSize: '12px'
        }}>
          Loading...
        </div>
      )}
      
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(0,0,0,0.7)',
        color: '#00ff88',
        padding: '5px 10px',
        borderRadius: '4px',
        fontSize: '12px',
        fontFamily: 'monospace'
      }}>
        {currentTimeframe}
        {isShiftPressed && (
          <span style={{ marginLeft: '10px', color: '#ff9900' }}>
            [LOCK LEFT]
          </span>
        )}
      </div>
    </div>
  );
};

export default AdaptiveChart;