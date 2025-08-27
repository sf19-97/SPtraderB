/**
 * MARKET DATA CHART
 * Generic chart component for all market data (forex, bitcoin, crypto, etc.)
 * Based on the proven Bitcoin pattern with cascade aggregates
 *
 * Features:
 * - Fractal zoom with automatic timeframe switching
 * - Real-time data updates
 * - Works with any asset using the cascade pattern
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CandlestickData, Time, MouseEventParams } from 'lightweight-charts';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useChartStore } from '../stores/useChartStore';
import { Box } from '@mantine/core';
import { CountdownTimer } from './CountdownTimer';
import { usePlaceholderCandle, calculateCandleTime } from '../hooks/usePlaceholderCandle';
import { getDaysToShowForTimeframe, setVisibleRangeByDays } from '../utils/chartHelpers';
import { useChartSetup } from '../hooks/useChartSetup';
import { useChartZoom, type VisibleRange } from '../hooks/useChartZoom';
import { getBarSpacingForTimeframeSwitch } from '../hooks/useAutoTimeframeSwitch';
import { useChartMachine } from '../machines/chartStateMachine';
import { useChartData } from '../hooks/useChartData';
import { useSelector } from '@xstate/react';

interface MarketDataChartProps {
  symbol?: string;
  timeframe?: string;
  onTimeframeChange?: (timeframe: string) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}


interface StreamStatus {
  connected: boolean;
  message: string;
}

const MarketDataChart: React.FC<MarketDataChartProps> = ({
  symbol,
  timeframe,
  onTimeframeChange,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const componentId = useRef(Math.random().toString(36).substr(2, 9));

  // Initialize state machine with initial context
  const {
    service,
    updateBarSpacing,
    requestTimeframeChange,
    setVisibleRange,
    notifyDataLoaded,
    notifyDataError,
    notifySymbolChanged,
  } = useChartMachine({
    symbol: symbol || 'EURUSD',
    timeframe: timeframe || '1h',
  });
  
  // Get state and context from machine
  const state = useSelector(service, (state) => state);
  
  // Log the state machine state
  useEffect(() => {
    if (state) {
      console.log(`[MarketDataChart ${componentId.current}] State machine state:`, state.value);
    } else {
      console.log(`[MarketDataChart ${componentId.current}] State is null`);
    }
  }, [state]);
  const context = state?.context || { symbol: symbol || 'EURUSD', timeframe: timeframe || '1h', opacity: 1 };
  const isLoading = state?.matches('loading') || false;
  const isTransitioning = state?.matches('transitioning') || false;
  const chartOpacity = context?.opacity ?? 1;

  // Keep refs for backward compatibility
  const currentTimeframeRef = useRef(context.timeframe || timeframe || '1h');
  const symbolRef = useRef(context.symbol || symbol || 'EURUSD');
  
  // Update refs when context changes
  useEffect(() => {
    currentTimeframeRef.current = context.timeframe;
    symbolRef.current = context.symbol;
  }, [context.timeframe, context.symbol]);

  // Format prices
  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }
    return `$${price.toFixed(2)}`;
  };

  // Use the chart setup hook
  const { chart, series, isReady: chartReady } = useChartSetup(chartContainerRef, {
    theme: {
      backgroundColor: '#0a0a0a',
      textColor: '#ffffff',
      gridColor: '#1a2a3a',
      borderColor: '#2B2B43',
      upColor: '#00ff88',
      downColor: '#ff4976',
      wickUpColor: '#00ff88',
      wickDownColor: '#ff4976',
    },
    chartOptions: {
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
        barSpacing: 12,
        minBarSpacing: 2,
        rightOffset: 5,
        rightBarStaysOnScroll: true,
        tickMarkFormatter: (time: number, tickMarkType: number) => {
          // Convert UTC timestamp to local time for axis labels
          const date = new Date(time * 1000);

          // Format based on the tick mark type
          if (tickMarkType === 0) {
            // Year
            return date.getFullYear().toString();
          } else if (tickMarkType === 1) {
            // Month
            const months = [
              'Jan',
              'Feb',
              'Mar',
              'Apr',
              'May',
              'Jun',
              'Jul',
              'Aug',
              'Sep',
              'Oct',
              'Nov',
              'Dec',
            ];
            return months[date.getMonth()];
          } else if (tickMarkType === 2) {
            // DayOfMonth
            return date.getDate().toString();
          } else if (tickMarkType === 3) {
            // Time
            const hours = date.getHours();
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12; // Convert 0 to 12
            return `${displayHours}:${minutes} ${ampm}`;
          } else if (tickMarkType === 4) {
            // TimeWithSeconds
            const hours = date.getHours();
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12; // Convert 0 to 12
            return `${displayHours}:${minutes}:${seconds} ${ampm}`;
          }

          // Default fallback
          return date.toLocaleString();
        },
      },
      localization: {
        timeFormatter: (timestamp: number) => {
          // Convert UTC timestamp to local time (12-hour format)
          const date = new Date(timestamp * 1000);
          const hours = date.getHours();
          const minutes = date.getMinutes().toString().padStart(2, '0');
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const displayHours = hours % 12 || 12; // Convert 0 to 12
          return `${displayHours}:${minutes} ${ampm}`;
        },
      },
    },
    seriesOptions: {
      priceFormat: {
        type: 'custom',
        formatter: formatPrice,
      },
    },
  });

  // Mounted ref to prevent events after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    console.log(`[MarketDataChart ${componentId.current}] Component mounted`);
    return () => {
      console.log(`[MarketDataChart ${componentId.current}] Component unmounting`);
      mountedRef.current = false;
    };
  }, []);

  // Real-time streaming state
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({
    connected: false,
    message: 'Not connected',
  });


  // Zustand store
  const {
    setCurrentTimeframe: setStoreTimeframe,
  } = useChartStore();

  // Use the chart data hook
  const {
    data: chartData,
    isLoading: dataLoading,
    error: dataError,
    fetchData,
    setDefaultRange,
  } = useChartData(symbolRef.current, currentTimeframeRef.current, {
    autoLoad: false, // We'll control loading through the state machine
  });

  // Placeholder candle management
  const {
    createPlaceholder,
    updateWithRealData,
    resetTrigger,
  } = usePlaceholderCandle(series);

  // Connect data loading to state machine
  useEffect(() => {
    if (dataError) {
      notifyDataError(dataError);
    } else if (chartData.length > 0 && dataLoading === false) {
      notifyDataLoaded();
    }
  }, [chartData, dataLoading, dataError, notifyDataError, notifyDataLoaded]);


  // Create stable callbacks that won't change between renders
  const handleBarSpacingChange = useCallback((newBarSpacing: number) => {
    console.log(`[MarketDataChart ${componentId.current}] Bar spacing callback: ${newBarSpacing}`);
    updateBarSpacing(newBarSpacing);
  }, [updateBarSpacing]);
  
  const handleVisibleRangeChange = useCallback((range: VisibleRange | null) => {
    setVisibleRange(range);
  }, [setVisibleRange]);
  
  // Use the chart zoom hook
  const {
    visibleRange,
  } = useChartZoom(chart, {
    onBarSpacingChange: handleBarSpacingChange,
    onVisibleRangeChange: handleVisibleRangeChange,
    barSpacingCheckInterval: 100,
  });



  // CRITICAL: Bar spacing thresholds are now handled in the state machine




  // Handle timeframe changes through callbacks
  useEffect(() => {
    if (context.timeframe !== currentTimeframeRef.current) {
      console.log(
        '[ResolutionTracker] Timeframe changed:',
        currentTimeframeRef.current,
        '→',
        context.timeframe
      );
      
      // Update Zustand store
      setStoreTimeframe(context.timeframe);
      if (onTimeframeChange) {
        onTimeframeChange(context.timeframe);
      }
    }
  }, [context.timeframe, setStoreTimeframe, onTimeframeChange]);

  // Listen for state machine transitions and load data
  useEffect(() => {
    // Only load data if we're in loading state and have valid context
    if (state && state.matches('loading') && context.symbol && context.timeframe) {
      console.log(`[StateMachine] Loading data for ${context.symbol} ${context.timeframe}`);
      
      // Fetch data through the hook
      fetchData().then(() => {
        console.log(`[StateMachine] Data fetch completed`);
      }).catch((error) => {
        console.error(`[StateMachine] Data fetch error:`, error);
        // The error is already handled by useChartData hook which calls notifyDataError
      });
    }
  }, [state, fetchData, context.symbol, context.timeframe]); // Include fetchData and context for proper loading

  // Track last applied data to prevent duplicates
  const lastAppliedDataRef = useRef<{ symbol: string; timeframe: string; count: number } | null>(null);
  
  // Apply chart data when loaded
  useEffect(() => {
    // Ensure we have all required components
    if (!chartData || !chartData.length || !series || !chart || dataLoading || !chartReady) {
      return;
    }

    // Check if we already applied this data
    const dataKey = { symbol: context.symbol, timeframe: context.timeframe, count: chartData.length };
    if (lastAppliedDataRef.current && 
        lastAppliedDataRef.current.symbol === dataKey.symbol &&
        lastAppliedDataRef.current.timeframe === dataKey.timeframe &&
        lastAppliedDataRef.current.count === dataKey.count) {
      return; // Already applied this exact data
    }
    
    console.log(`[StateMachine] Applying ${chartData.length} candles to chart`);
    lastAppliedDataRef.current = dataKey;

    // Apply data synchronously to avoid unmount issues
    try {
      // If transitioning between timeframes, calculate appropriate bar spacing
      let timeScale;
      let currentBarSpacing;
      try {
        timeScale = chart.timeScale();
        currentBarSpacing = timeScale.options().barSpacing;
      } catch (error) {
        console.error('[StateMachine] Error accessing chart timeScale:', error);
        return;
      }
      const previousTimeframe = currentTimeframeRef.current;
      
      if (context.timeframe !== previousTimeframe) {
        const newBarSpacing = getBarSpacingForTimeframeSwitch(
            currentBarSpacing,
            previousTimeframe,
            context.timeframe
        );

        // Apply bar spacing before setting data
        try {
          chart.timeScale().applyOptions({
            barSpacing: newBarSpacing,
          });
        } catch (error) {
          console.error('[StateMachine] Error applying bar spacing:', error);
          return;
        }
      }
      
      // Double-check chart and series are still valid
      if (!series || !chart) {
        console.warn('[StateMachine] Chart or series is null, waiting for next render');
        return;
      }
      
      // Check if this is a refresh or a full data load
      let currentData: CandlestickData[] = [];
      try {
        if (series) {
          currentData = [...series.data()]; // Convert readonly to mutable
        }
      } catch (error) {
        console.warn('[StateMachine] Error getting series data:', error);
        currentData = [];
      }
      
      if (currentData.length > 0 && state && state.matches('ready')) {
        // This is a refresh - merge data
        const firstNewTime = chartData[0].time;
        const existingIndex = currentData.findIndex(
          (c) => (c.time as number) >= firstNewTime
        );

        let mergedData;
        if (existingIndex >= 0) {
          // Merge with existing data
          mergedData = [...currentData.slice(0, existingIndex), ...chartData];
        } else {
          // New data is all after existing data
          mergedData = [...currentData, ...chartData];
        }

        console.log(
          `[StateMachine] Merging data: ${currentData.length} existing + ${chartData.length} new = ${mergedData.length} total`
        );
        
        // Validate merged data
        const validMergedData = mergedData.filter(candle => {
          if (!candle || typeof candle.time !== 'number' || 
              !Number.isFinite(candle.open) || !Number.isFinite(candle.high) || 
              !Number.isFinite(candle.low) || !Number.isFinite(candle.close)) {
            console.warn('[StateMachine] Invalid candle in merged data:', candle);
            return false;
          }
          return true;
        });
        
        if (validMergedData.length !== mergedData.length) {
          console.warn(`[StateMachine] Filtered out ${mergedData.length - validMergedData.length} invalid candles from merged data`);
        }
        
        if (series) {
          updateWithRealData(validMergedData as CandlestickData[]);
        } else {
          console.warn('[StateMachine] Cannot update with real data - series is null');
        }
      } else {
        // Full data load
        console.log(`[StateMachine] Setting ${chartData.length} candles on series`);
        // Validate data before setting
        const validData = chartData.filter(candle => {
          if (!candle || typeof candle.time !== 'number' || 
              !Number.isFinite(candle.open) || !Number.isFinite(candle.high) || 
              !Number.isFinite(candle.low) || !Number.isFinite(candle.close)) {
            console.warn('[StateMachine] Invalid candle data detected:', candle);
            return false;
          }
          return true;
        });
        
        if (validData.length !== chartData.length) {
          console.warn(`[StateMachine] Filtered out ${chartData.length - validData.length} invalid candles`);
        }
        
        if (series) {
          try {
            series.setData(validData as CandlestickData[]);
            console.log(`[StateMachine] Data set complete with ${validData.length} valid candles`);
            
            // Force a chart update
            if (chart) {
              chart.timeScale().fitContent();
            }
          } catch (error) {
            console.error('[StateMachine] Error setting data on series:', error);
          }
        } else {
          console.error('[StateMachine] Series is null, cannot set data');
        }
      }

      // Maintain view range if we have one
      if (visibleRange && chart) {
        // Normal behavior - maintain visible range
        try {
          chart.timeScale().setVisibleRange({
            from: visibleRange.from as Time,
            to: visibleRange.to as Time,
          });
        } catch (error) {
          console.error('[StateMachine] Error setting visible range:', error);
        }
      }
    } catch (error) {
      console.error('[StateMachine] Error applying chart data:', error);
    }
  }, [chartData, dataLoading, context.timeframe, visibleRange, state, series, chart, chartReady]);

  // Crosshair and tooltip effect
  useEffect(() => {
    if (!chart || !series || !chartContainerRef.current) return;

    console.log('[MarketDataChart] Setting up crosshair and tooltip');

    // Create crosshair tooltip
    const toolTip = document.createElement('div');
    toolTip.style.cssText = `
      position: absolute;
      display: none;
      padding: 8px;
      box-sizing: border-box;
      font-size: 12px;
      text-align: left;
      z-index: 1000;
      top: 12px;
      left: 12px;
      pointer-events: none;
      background: rgba(0, 0, 0, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    if (chartContainerRef.current) {
      chartContainerRef.current.appendChild(toolTip);
    }

    // Subscribe to crosshair move
    const crosshairMoveHandler = (param: MouseEventParams<Time>) => {
      if (!param.time || !param.seriesData.has(series)) {
        toolTip.style.display = 'none';
        return;
      }

      const data = param.seriesData.get(series) as CandlestickData;
      if (!data) {
        toolTip.style.display = 'none';
        return;
      }
      
      const timestamp =
        typeof param.time === 'string'
          ? parseInt(param.time) * 1000
          : (param.time as number) * 1000;
      const date = new Date(timestamp);

      // Format date and time
      const dateStr = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const timeStr = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

      toolTip.style.display = 'block';
      toolTip.innerHTML = `
        <div style="color: #999; margin-bottom: 4px">${dateStr} ${timeStr}</div>
        <div style="color: #fff">O: ${formatPrice(data.open)}</div>
        <div style="color: #fff">H: ${formatPrice(data.high)}</div>
        <div style="color: #fff">L: ${formatPrice(data.low)}</div>
        <div style="color: ${data.close >= data.open ? '#00ff88' : '#ff4976'}">C: ${formatPrice(data.close)}</div>
      `;
    };
    
    chart.subscribeCrosshairMove(crosshairMoveHandler);

    return () => {
      chart.unsubscribeCrosshairMove(crosshairMoveHandler);
      if (toolTip && toolTip.parentNode) {
        toolTip.parentNode.removeChild(toolTip);
      }
    };
  }, [chart, series]);


  // Set default range on mount - only if coordinator hasn't already set one
  useEffect(() => {
    if (!symbol || !timeframe) return;
    
    // Let ChartDataCoordinator handle the default range calculation
    // It already has the same logic and this avoids duplicate calculations
    console.log(`[MarketDataChart] ChartDataCoordinator will handle default range for ${symbol}-${timeframe}`);
  }, [symbol, timeframe]);

  // Apply initial view range when data is loaded - only once per data load
  const hasSetInitialRange = useRef(false);
  
  useEffect(() => {
    // Only set initial range once when data first loads and chart is ready
    if (!hasSetInitialRange.current && chartData.length > 0 && chart && series && chartReady) {
      try {
        // Ensure the series has data before setting visible range
        const seriesData = series.data();
        if (seriesData && seriesData.length > 0) {
          const daysToShow = getDaysToShowForTimeframe(context.timeframe);
          setVisibleRangeByDays(chart, daysToShow);
          console.log(`[MarketDataChart] Set initial visible range to ${daysToShow} days for ${context.timeframe}`);
          hasSetInitialRange.current = true;
        }
      } catch (error) {
        console.warn('[MarketDataChart] Could not set visible range:', error);
      }
    }
  }, [chartData.length > 0, chart, series, chartReady, context.timeframe]);
  
  // Reset the flag when timeframe changes
  useEffect(() => {
    hasSetInitialRange.current = false;
  }, [context.timeframe]);

  // Handle external timeframe changes
  useEffect(() => {
    if (
      timeframe &&
      timeframe !== context.timeframe &&
      !isTransitioning &&
      state && state.matches('ready')
    ) {
      console.log(`[EXTERNAL] Requesting timeframe change to ${timeframe}`);
      requestTimeframeChange(timeframe);
    }
  }, [timeframe, context.timeframe, isTransitioning, state, requestTimeframeChange]);

  // Handle symbol prop changes
  useEffect(() => {
    if (!symbol || symbol === context.symbol) return;

    // Only reload if symbol actually changed AND we're ready
    if (state && state.matches('ready')) {
      console.log('[MarketDataChart] Symbol changed from', context.symbol, 'to', symbol);
      
      // Clear existing chart data immediately
      if (series) {
        console.log('[MarketDataChart] Clearing chart data for symbol change');
        series.setData([]);
      }
      
      // Notify state machine of symbol change
      notifySymbolChanged(symbol);
      
      // Clear placeholder
      if (resetTrigger) {
        resetTrigger();
      }
    }
  }, [symbol, context.symbol, state, series, notifySymbolChanged, resetTrigger]);

  // Real-time data streaming effect
  useEffect(() => {
    console.log('[MarketDataChart] Real-time streaming effect triggered');
    let mounted = true;
    let unlistenStatus: (() => void) | undefined;
    let unlistenCandle: (() => void) | undefined;

    const startStreaming = async () => {
      try {
        // Start the candle update monitor
        console.log('[MarketDataChart] Starting candle update monitor...');
        await invoke('start_candle_monitor');
        console.log('[MarketDataChart] Candle monitor started successfully');

        // Listen for candle update events specific to current timeframe
        const updateListener = async () => {
          // Clean up previous listener
          if (unlistenCandle) {
            unlistenCandle();
          }

          // Listen for updates to the current timeframe
          const eventName = `market-candles-updated-${currentTimeframeRef.current}`;
          console.log(`[MarketDataChart] Listening for ${eventName} events`);

          unlistenCandle = await listen<{ symbol: string; timeframe: string; timestamp: string }>(
            eventName,
            (event) => {
              if (!mounted) return;
              console.log('[MarketDataChart] Candle update received:', event.payload);

              // Just log the update - periodic refresh will handle data fetching
              if (event.payload.timeframe === currentTimeframeRef.current) {
                console.log('[MarketDataChart] Candle update notification received, periodic refresh will handle it');
              }
            }
          );
        };

        await updateListener();

        // Listen for connection status
        unlistenStatus = await listen<StreamStatus>('market-stream-status', (event) => {
          if (!mounted) return;
          console.log('[MarketDataChart] Stream status:', event.payload);
          setStreamStatus(event.payload);
        });
      } catch (error) {
        console.error('[MarketDataChart] Failed to start market stream:', error);
        if (mounted) {
          setStreamStatus({ connected: false, message: `Error: ${error}` });
        }
      }
    };

    startStreaming();

    // Cleanup
    return () => {
      mounted = false;
      if (unlistenStatus) unlistenStatus();
      if (unlistenCandle) unlistenCandle();

      // Stop the candle monitor when component unmounts
      console.log('[MarketDataChart] Stopping candle monitor on unmount');
      invoke('stop_candle_monitor').catch(console.error);
    };
  }, []); // Only run once on mount

  // Simple periodic refresh to catch aggregate updates
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Calculate initial delay to sync with clock
    const now = new Date();
    const currentSecond = now.getSeconds();
    // Target times: 1 second after cascade runs (:01, :06, :11, etc)
    const targets = [2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57];

    let nextTarget = targets.find((t) => t > currentSecond);
    let delaySeconds;
    if (!nextTarget) {
      // Wrap to next minute
      nextTarget = targets[0];
      delaySeconds = (60 - currentSecond) + nextTarget;
    } else {
      delaySeconds = nextTarget - currentSecond;
    }

    console.log(
      `[MarketDataChart] Syncing periodic refresh - current: :${currentSecond}, next: :${nextTarget % 60}, delay: ${delaySeconds}s`
    );

    // Initial delay to sync with clock
    timeoutId = setTimeout(() => {
      // Now start the interval, properly aligned
      intervalId = setInterval(() => {
        // Only refresh if we have a chart and not loading or transitioning
        if (chart && !isLoading && !isTransitioning) {
          console.log('[MarketDataChart] Periodic refresh check at', new Date().toLocaleTimeString());

          // Use the data hook to fetch updated data
          fetchData().catch((error) => {
            console.error('[MarketDataChart] Periodic refresh error:', error);
          });
        }
      }, 30000); // PERFORMANCE FIX: Changed from 5s to 30s
      // Was hammering the database with requests every 5 seconds
      // Combined with timestamp normalization, this dramatically reduces load
    }, delaySeconds * 1000);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []); // No dependencies needed since we use refs


  // Regular mode
  return (
    <Box style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={chartContainerRef}
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0a0a',
          position: 'relative',
          opacity: chartOpacity,
          transition: 'opacity 300ms ease-in-out',
        }}
      >
        {isLoading && (
          <div
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              background: 'rgba(0,0,0,0.7)',
              color: '#fff',
              padding: '5px 10px',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            Loading...
          </div>
        )}
        
        {state && state.matches('error') && context.error && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(255, 0, 0, 0.1)',
              color: '#ff4976',
              padding: '20px',
              borderRadius: '8px',
              fontSize: '14px',
              border: '1px solid #ff4976',
            }}
          >
            Error: {context.error}
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            background: 'rgba(0,0,0,0.7)',
            color: '#00ff88',
            padding: '5px 10px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
          }}
        >
          {context.timeframe}
        </div>

        {/* Countdown Timer - only create placeholders when streaming is active */}
        <CountdownTimer
          timeframe={context.timeframe}
          position="bottom-right"
          offset={{ x: 10, y: 10 }}
          onNewCandleBoundary={(time) => {
            // Only create placeholder if we have a series and streaming is connected
            if (series && streamStatus.connected) {
              const candleTime = calculateCandleTime(time, context.timeframe);
              createPlaceholder(candleTime);
            }
          }}
        />
      </div>
    </Box>
  );
};

export default MarketDataChart;
