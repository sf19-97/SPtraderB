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

import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useChartStore } from '../stores/useChartStore';
import { Box } from '@mantine/core';
import { chartDataCoordinator, type SymbolMetadata } from '../services/ChartDataCoordinator';
import { CountdownTimer } from './CountdownTimer';
import { usePlaceholderCandle, calculateCandleTime } from '../hooks/usePlaceholderCandle';
import { getDaysToShowForTimeframe, setVisibleRangeByDays } from '../utils/chartHelpers';
import { useChartSetup } from '../hooks/useChartSetup';
import { useChartZoom } from '../hooks/useChartZoom';
import { getBarSpacingForTimeframeSwitch } from '../hooks/useAutoTimeframeSwitch';
import { useChartMachine } from '../machines/chartStateMachine';
import { useChartData } from '../hooks/useChartData';
import { useSelector } from '@xstate/react';

interface ChartData {
  time: number; // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
}

interface MarketDataChartProps {
  symbol?: string;
  timeframe?: string;
  onTimeframeChange?: (timeframe: string) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}


interface MarketTick {
  timestamp: string;
  symbol: string;
  bid: number;
  ask: number;
  last?: number;
}

interface StreamStatus {
  connected: boolean;
  message: string;
}

const MarketDataChart: React.FC<MarketDataChartProps> = ({
  symbol,
  timeframe,
  onTimeframeChange,
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Initialize state machine
  const {
    service,
    initialize,
    updateBarSpacing,
    requestTimeframeChange,
    setShiftPressed,
    setVisibleRange,
    notifyDataLoaded,
    notifyDataError,
    notifySymbolChanged,
  } = useChartMachine();

  // Get state and context from machine
  const state = useSelector(service, (state) => state);
  const { context } = state;
  const isLoading = state.matches('loading');
  const isTransitioning = state.matches('transitioning');
  const chartOpacity = context.opacity;

  // Keep refs for backward compatibility
  const currentTimeframeRef = useRef(context.timeframe || timeframe || '1h');
  const symbolRef = useRef(context.symbol || symbol || 'EURUSD');
  
  // Update refs when context changes
  useEffect(() => {
    currentTimeframeRef.current = context.timeframe;
    symbolRef.current = context.symbol;
  }, [context.timeframe, context.symbol]);

  // Use the chart setup hook
  const { chart, series, isReady: chartReady } = useChartSetup({
    containerRef: chartContainerRef,
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
        tickMarkFormatter: (time: number, tickMarkType: number, locale: string) => {
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

  // Create refs for backward compatibility
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  
  // Update refs when chart/series change
  useEffect(() => {
    chartRef.current = chart;
    seriesRef.current = series;
  }, [chart, series]);

  // Real-time streaming state
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({
    connected: false,
    message: 'Not connected',
  });
  const [lastTick, setLastTick] = useState<MarketTick | null>(null);


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
    hasPlaceholder,
    getPlaceholderTime,
    resetTrigger,
  } = usePlaceholderCandle(seriesRef.current);

  // Connect data loading to state machine
  useEffect(() => {
    if (dataError) {
      notifyDataError(dataError);
    } else if (chartData.length > 0 && dataLoading === false) {
      notifyDataLoaded();
    }
  }, [chartData, dataLoading, dataError, notifyDataError, notifyDataLoaded]);

  // Define checkTimeframeSwitch function (kept for reference but not used)
  const checkTimeframeSwitch = (barSpacing: number) => {
    // Verbose logging - uncomment for debugging
    // console.log(`[checkTimeframeSwitch] Called with barSpacing: ${barSpacing}`);
    // console.log(`[checkTimeframeSwitch] isTransitioningRef.current: ${isTransitioningRef.current}`);
    // console.log(`[checkTimeframeSwitch] currentTimeframeRef.current: ${currentTimeframeRef.current}`);
    
    if (isTransitioning) {
      // console.log('[SWITCH] Skipping - transition in progress');
      return; // Silent skip during transitions
    }

    const currentTf = currentTimeframeRef.current;

    // Enforce minimum bar spacing for 12h to prevent excessive zoom out
    if (currentTf === '12h' && barSpacing < 3) {
      // console.log('[ZOOM LIMIT] Enforcing minimum bar spacing for 12h');
      chartRef.current?.timeScale().applyOptions({
        barSpacing: 3,
      });
      return;
    }

    // 12h → 4h (zooming in)
    if (currentTf === '12h' && barSpacing > SWITCH_FROM_12H_BAR_SPACING) {
      console.log(
        `[SWITCH] 12h bar spacing ${barSpacing} > ${SWITCH_FROM_12H_BAR_SPACING} → switching to 4h`
      );
      switchTimeframe('4h');
    }
    // 4h → 12h (zooming out)
    else if (currentTf === '4h' && barSpacing < SWITCH_TO_12H_BAR_SPACING) {
      console.log(
        `[SWITCH] 4h bar spacing ${barSpacing} < ${SWITCH_TO_12H_BAR_SPACING} → switching to 12h`
      );
      switchTimeframe('12h');
    }
    // 4h → 1h (zooming in)
    else if (currentTf === '4h' && barSpacing > SWITCH_FROM_4H_BAR_SPACING) {
      console.log(
        `[SWITCH] 4h bar spacing ${barSpacing} > ${SWITCH_FROM_4H_BAR_SPACING} → switching to 1h`
      );
      switchTimeframe('1h');
    }
    // 1h → 4h (zooming out)
    else if (currentTf === '1h' && barSpacing < SWITCH_TO_4H_BAR_SPACING) {
      console.log(
        `[SWITCH] 1h bar spacing ${barSpacing} < ${SWITCH_TO_4H_BAR_SPACING} → switching to 4h`
      );
      switchTimeframe('4h');
    }
    // 1h → 15m (zooming in)
    else if (currentTf === '1h' && barSpacing > SWITCH_TO_15M_BAR_SPACING) {
      console.log(
        `[SWITCH] 1h bar spacing ${barSpacing} > ${SWITCH_TO_15M_BAR_SPACING} → switching to 15m`
      );
      switchTimeframe('15m');
    }
    // 15m → 1h (zooming out)
    else if (currentTf === '15m' && barSpacing < SWITCH_TO_1H_BAR_SPACING) {
      console.log(
        `[SWITCH] 15m bar spacing ${barSpacing} < ${SWITCH_TO_1H_BAR_SPACING} → switching to 1h`
      );
      switchTimeframe('1h');
    }
    // 15m → 5m (zooming in)
    else if (currentTf === '15m' && barSpacing > SWITCH_TO_5M_BAR_SPACING) {
      console.log(
        `[SWITCH] 15m bar spacing ${barSpacing} > ${SWITCH_TO_5M_BAR_SPACING} → switching to 5m`
      );
      switchTimeframe('5m');
    }
    // 5m → 15m (zooming out)
    else if (currentTf === '5m' && barSpacing < SWITCH_FROM_5M_BAR_SPACING) {
      console.log(
        `[SWITCH] 5m bar spacing ${barSpacing} < ${SWITCH_FROM_5M_BAR_SPACING} → switching to 15m`
      );
      switchTimeframe('15m');
    }
  };

  // Use the chart zoom hook
  const {
    isShiftPressed,
    lockedLeftEdge,
    visibleRange,
    barSpacing,
    maintainLeftEdgeLock,
  } = useChartZoom(chart, {
    onBarSpacingChange: (newBarSpacing) => {
      // Send bar spacing updates to state machine
      updateBarSpacing(newBarSpacing);
    },
    onVisibleRangeChange: (range) => {
      setVisibleRange(range);
    },
    barSpacingCheckInterval: 100,
  });
  
  // Update shift state in machine
  useEffect(() => {
    setShiftPressed(isShiftPressed);
  }, [isShiftPressed, setShiftPressed]);
  
  // Use ref for locked left edge for backward compatibility
  const lockedLeftEdgeRef = useRef<number | null>(null);
  useEffect(() => {
    lockedLeftEdgeRef.current = lockedLeftEdge;
  }, [lockedLeftEdge]);



  // CRITICAL: Use bar spacing thresholds, not pixel widths
  const SWITCH_TO_5M_BAR_SPACING = 35; // When 15m bars are spread this wide, switch to 5m
  const SWITCH_TO_15M_BAR_SPACING = 32; // When 1h bars are spread this wide, switch to 15m
  const SWITCH_FROM_5M_BAR_SPACING = 7; // When 5m bars are squeezed this tight, switch to 15m
  const SWITCH_TO_1H_BAR_SPACING = 8; // When 15m bars are squeezed this tight, switch to 1h
  const SWITCH_TO_4H_BAR_SPACING = 8; // When 1h bars are squeezed this tight, switch to 4h
  const SWITCH_FROM_4H_BAR_SPACING = 32; // When 4h bars are spread this wide, switch to 1h
  const SWITCH_TO_12H_BAR_SPACING = 4; // When 4h bars are squeezed this tight, switch to 12h
  const SWITCH_FROM_12H_BAR_SPACING = 24; // When 12h bars are spread this wide, switch to 4h (3x factor)

  // Format prices
  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }
    return `$${price.toFixed(2)}`;
  };

  // Get timeframe duration in seconds
  const getTimeframeSeconds = (timeframe: string): number => {
    switch (timeframe) {
      case '5m':
        return 5 * 60;
      case '15m':
        return 15 * 60;
      case '1h':
        return 60 * 60;
      case '4h':
        return 4 * 60 * 60;
      case '12h':
        return 12 * 60 * 60;
      default:
        return 60 * 60; // Default to 1h
    }
  };



  // Remove manual checkTimeframeSwitch - state machine handles this
  useEffect(() => {
    // When state machine suggests a timeframe change, apply it
    if (state.matches('transitioning') && context.timeframe !== currentTimeframeRef.current) {
      switchTimeframe(context.timeframe);
    }
  }, [state.value, context.timeframe]);

  // Rest of the component logic remains the same as AdaptiveChart
  // Using generic market data fetching and formatting...

  const switchTimeframe = (newTimeframe: string) => {
    if (newTimeframe === context.timeframe || isTransitioning) return;

    console.log(
      '[ResolutionTracker] Timeframe transition:',
      context.timeframe,
      '→',
      newTimeframe
    );

    // Request timeframe change through state machine
    requestTimeframeChange(newTimeframe);
    
    // Update Zustand store
    setStoreTimeframe(newTimeframe);
    if (onTimeframeChange) {
      onTimeframeChange(newTimeframe);
    }
  };

  // Listen for state machine transitions and load data
  useEffect(() => {
    if (state.matches('loading') && context.symbol && context.timeframe) {
      console.log(`[StateMachine] Loading data for ${context.symbol} ${context.timeframe}`);
      
      // Fetch data through the hook
      fetchData().then(() => {
        console.log(`[StateMachine] Data fetch completed`);
      }).catch((error) => {
        console.error(`[StateMachine] Data fetch error:`, error);
      });
    }
  }, [state.value, context.symbol, context.timeframe, fetchData]);

  // Apply chart data when loaded
  useEffect(() => {
    if (chartData.length > 0 && seriesRef.current && chartRef.current && !dataLoading) {
      console.log(`[StateMachine] Applying ${chartData.length} candles to chart`);

      const applyData = async () => {
        // If transitioning between timeframes, calculate appropriate bar spacing
        const timeScale = chartRef.current!.timeScale();
        const currentBarSpacing = timeScale.options().barSpacing;
        const previousTimeframe = currentTimeframeRef.current;
        
        if (context.timeframe !== previousTimeframe) {
          const newBarSpacing = getBarSpacingForTimeframeSwitch(
            currentBarSpacing,
            previousTimeframe,
            context.timeframe
          );

          // Apply bar spacing before setting data
          chartRef.current!.timeScale().applyOptions({
            barSpacing: newBarSpacing,
          });
        }
        
        // Wait for next animation frame to ensure display surface is ready
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        
        // Check if this is a refresh or a full data load
        const currentData = seriesRef.current!.data();
        if (currentData.length > 0 && state.matches('ready')) {
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
          updateWithRealData(mergedData as any);
        } else {
          // Full data load
          console.log(`[StateMachine] Setting ${chartData.length} candles on series`);
          seriesRef.current!.setData(chartData as any);
          console.log(`[StateMachine] Data set complete`);
        }

        // Maintain view range if we have one
        if (visibleRange && chartRef.current) {
          if (isShiftPressed && lockedLeftEdgeRef.current !== null) {
            // Keep left edge locked
            const currentDuration = visibleRange.to - visibleRange.from;
            const ratio = context.timeframe === previousTimeframe
              ? 1
              : getBarSpacingForTimeframeSwitch(1, previousTimeframe, context.timeframe);

            const newDuration = currentDuration / ratio;
            const newTo = lockedLeftEdgeRef.current + newDuration;

            chartRef.current.timeScale().setVisibleRange({
              from: lockedLeftEdgeRef.current as any,
              to: newTo as any,
            });
          } else if (visibleRange) {
            // Normal behavior - maintain visible range
            chartRef.current.timeScale().setVisibleRange({
              from: visibleRange.from as any,
              to: visibleRange.to as any,
            });
          }
        }
      };

      applyData();
    }
  }, [chartData, dataLoading, context.timeframe, visibleRange, isShiftPressed, state.value]);

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
    chartContainerRef.current.appendChild(toolTip);

    // Subscribe to crosshair move
    const unsubscribe = chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.has(series)) {
        toolTip.style.display = 'none';
        return;
      }

      const data = param.seriesData.get(series) as any;
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
    });

    return () => {
      unsubscribe();
      if (toolTip && toolTip.parentNode) {
        toolTip.parentNode.removeChild(toolTip);
      }
    };
  }, [chart, series]);


  // Initialize state machine on mount
  useEffect(() => {
    if (!symbol || !chartReady) return;
    
    console.log('[MarketDataChart] Initializing state machine');
    initialize(symbol, timeframe || '1h');
    
    // Set default range for data fetching
    const now = Math.floor(Date.now() / 1000);
    const to = now + 60 * 60; // 1 hour into the future for ongoing candles
    let from;
    if (timeframe === '5m') {
      from = now - 30 * 24 * 60 * 60; // 30 days for 5m
    } else {
      from = now - 90 * 24 * 60 * 60; // 90 days for others
    }
    
    setDefaultRange(from, to);
  }, [symbol, timeframe, chartReady, initialize, setDefaultRange]);

  // Apply initial view range when data is loaded
  useEffect(() => {
    if (chartData.length > 0 && chartRef.current && state.matches('ready')) {
      const daysToShow = getDaysToShowForTimeframe(context.timeframe);
      setVisibleRangeByDays(chartRef.current, daysToShow);
      console.log(`[MarketDataChart] Set visible range to ${daysToShow} days for ${context.timeframe}`);
    }
  }, [chartData.length, state.value, context.timeframe]);

  // Handle external timeframe changes
  useEffect(() => {
    if (
      timeframe &&
      timeframe !== currentTimeframeRef.current &&
      !isTransitioningRef.current &&
      initialLoadDoneRef.current
    ) {
      console.log(`[EXTERNAL] Switching to ${timeframe} from external control`);
      switchTimeframe(timeframe);
    }
  }, [timeframe]);

  // Handle symbol prop changes
  useEffect(() => {
    if (!symbol) return;

    const prevSymbol = symbolRef.current;
    symbolRef.current = symbol;

    // Only reload if symbol actually changed AND we're ready
    if (
      prevSymbol !== symbol &&
      chartRef.current &&
      state.matches('ready') &&
      prevSymbol !== undefined
    ) {
      console.log('[MarketDataChart] Symbol changed from', prevSymbol, 'to', symbol);
      
      // Clear existing chart data immediately
      if (seriesRef.current) {
        console.log('[MarketDataChart] Clearing chart data for symbol change');
        seriesRef.current.setData([]);
      }
      
      // Notify state machine of symbol change
      notifySymbolChanged(symbol);
      
      // Clear placeholder
      if (resetTrigger) {
        resetTrigger();
      }
    }
  }, [symbol]);

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
    if (!nextTarget) {
      nextTarget = targets[0] + 60; // Wrap to next minute
    }

    let delaySeconds = nextTarget - currentSecond;
    if (delaySeconds > 60) {
      delaySeconds -= 60;
    }

    console.log(
      `[MarketDataChart] Syncing periodic refresh - current: :${currentSecond}, next: :${nextTarget % 60}, delay: ${delaySeconds}s`
    );

    // Initial delay to sync with clock
    timeoutId = setTimeout(() => {
      // Now start the interval, properly aligned
      intervalId = setInterval(() => {
        // Only refresh if we have a chart and not loading or transitioning
        if (chartRef.current && !isLoading && !isTransitioning) {
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
        
        {state.matches('error') && context.error && (
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
          {isShiftPressed && (
            <span style={{ marginLeft: '10px', color: '#ff9900' }}>[LOCK LEFT]</span>
          )}
        </div>

        {/* Countdown Timer */}
        <CountdownTimer
          timeframe={context.timeframe}
          position="bottom-right"
          offset={{ x: 10, y: 10 }}
          onNewCandleBoundary={(time) => {
            const candleTime = calculateCandleTime(time, context.timeframe);
            createPlaceholder(candleTime);
          }}
        />
      </div>
    </Box>
  );
};

export default MarketDataChart;
