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

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useChartStore } from '../stores/useChartStore';
import { ActionIcon, Group, Text, Box, Badge } from '@mantine/core';
import { IconMaximize, IconMinimize, IconCircleFilled } from '@tabler/icons-react';

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

interface BitcoinTick {
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
  
  // Real-time streaming state
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({ connected: false, message: 'Not connected' });
  const [lastTick, setLastTick] = useState<BitcoinTick | null>(null);
  
  // Countdown timer state
  const [countdown, setCountdown] = useState<string>('00:00');
  const [countdownColor, setCountdownColor] = useState<string>('#999');
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCountdownUpdateRef = useRef<number>(0);
  
  // Zustand store
  const { 
    getCachedCandles, 
    setCachedCandles, 
    getCacheKey,
    invalidateCache,
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
  
  // Date range tracking
  const dateRangeRef = useRef<{ from: number; to: number } | null>(null);
  
  // Track if initial load has been done
  const initialLoadDoneRef = useRef(false);
  
  // CRITICAL: Use bar spacing thresholds, not pixel widths
  const SWITCH_TO_1M_BAR_SPACING = 40;   // When 5m bars are spread this wide, switch to 1m
  const SWITCH_TO_5M_BAR_SPACING = 35;   // When 15m bars are spread this wide, switch to 5m
  const SWITCH_TO_15M_BAR_SPACING = 32;  // When 1h bars are spread this wide, switch to 15m
  const SWITCH_FROM_1M_BAR_SPACING = 6;  // When 1m bars are squeezed this tight, switch to 5m
  const SWITCH_FROM_5M_BAR_SPACING = 7;  // When 5m bars are squeezed this tight, switch to 15m
  const SWITCH_TO_1H_BAR_SPACING = 8;    // When 15m bars are squeezed this tight, switch to 1h
  const SWITCH_TO_4H_BAR_SPACING = 8;    // When 1h bars are squeezed this tight, switch to 4h
  const SWITCH_FROM_4H_BAR_SPACING = 32; // When 4h bars are spread this wide, switch to 1h
  const SWITCH_TO_12H_BAR_SPACING = 4;   // When 4h bars are squeezed this tight, switch to 12h
  const SWITCH_FROM_12H_BAR_SPACING = 24; // When 12h bars are spread this wide, switch to 4h (3x factor)

  // Format large Bitcoin prices
  const formatBitcoinPrice = (price: number): string => {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }
    return `$${price.toFixed(2)}`;
  };
  
  // Get timeframe duration in seconds
  const getTimeframeSeconds = (timeframe: string): number => {
    switch (timeframe) {
      case '1m': return 60;
      case '5m': return 5 * 60;
      case '15m': return 15 * 60;
      case '1h': return 60 * 60;
      case '4h': return 4 * 60 * 60;
      case '12h': return 12 * 60 * 60;
      default: return 60 * 60; // Default to 1h
    }
  };
  
  // Update countdown timer
  const updateCountdown = useCallback(() => {
    const now = Date.now();
    
    // Throttle updates to exactly 1 second intervals
    if (now - lastCountdownUpdateRef.current < 950) return;
    lastCountdownUpdateRef.current = now;
    
    const date = new Date(now);
    const seconds = date.getSeconds();
    const minutes = date.getMinutes();
    const hours = date.getHours();
    
    let secondsRemaining = 0;
    
    // Calculate seconds until next candle boundary
    switch (currentTimeframeRef.current) {
      case '1m':
        secondsRemaining = 60 - seconds;
        break;
      case '5m':
        secondsRemaining = (5 - (minutes % 5)) * 60 - seconds;
        break;
      case '15m':
        secondsRemaining = (15 - (minutes % 15)) * 60 - seconds;
        break;
      case '1h':
        secondsRemaining = (60 - minutes) * 60 - seconds;
        break;
      case '4h':
        secondsRemaining = (4 - (hours % 4)) * 3600 + (60 - minutes) * 60 - seconds;
        break;
      case '12h':
        secondsRemaining = (12 - (hours % 12)) * 3600 + (60 - minutes) * 60 - seconds;
        break;
    }
    
    // Format countdown
    const totalSeconds = Math.max(0, secondsRemaining);
    const displayMinutes = Math.floor(totalSeconds / 60);
    const displaySeconds = totalSeconds % 60;
    const formattedTime = `${displayMinutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`;
    
    // Update countdown display
    setCountdown(formattedTime);
    
    // Color coding based on time remaining
    if (totalSeconds <= 10) {
      setCountdownColor('#ffae00'); // Yellow warning
    } else if (totalSeconds <= 30) {
      setCountdownColor('#ccc'); // Brighter gray
    } else {
      setCountdownColor('#999'); // Dimmed gray
    }
  }, []);
  
  // Resize chart when fullscreen mode changes
  useEffect(() => {
    if (chartRef.current) {
      // Small delay to allow DOM to update
      setTimeout(() => {
        chartRef.current?.applyOptions({
          width: chartContainerRef.current?.clientWidth || 0,
          height: chartContainerRef.current?.clientHeight || 0,
        });
      }, 50);
    }
  }, [isFullscreen]);

  const fetchChartData = async (sym: string, tf: string, from?: number, to?: number): Promise<{ data: ChartData[], metadata: SymbolMetadata | null }> => {
    try {
      // Calculate date range if not provided
      if (!from || !to) {
        const now = Math.floor(Date.now() / 1000);
        to = now + (60 * 60); // 1 hour into future
        
        // Use smaller window for high-frequency timeframes
        if (tf === '1m') {
          from = now - (7 * 24 * 60 * 60); // 7 days for 1m candles
        } else if (tf === '5m') {
          from = now - (30 * 24 * 60 * 60); // 30 days for 5m candles
        } else {
          from = now - (90 * 24 * 60 * 60); // 90 days for others
        }
      }
      
      // Always update the date range ref so periodic refresh works
      dateRangeRef.current = { from: from!, to: to! };
      
      console.log(`[BitcoinChart] Fetching ${tf} data from ${new Date(from * 1000).toISOString()} to ${new Date(to * 1000).toISOString()}`);
      console.log(`[BitcoinChart] Timestamps - from: ${from}, to: ${to}`);
      
      // IMPORTANT: For Bitcoin, we'll use a different command that queries bitcoin_candles_* tables
      const response = await invoke<any>('get_bitcoin_chart_data', { 
        symbol: sym, 
        timeframe: tf,
        from: from,
        to: to
      });
      
      console.log(`[BitcoinChart] Received ${response.data?.length || 0} candles`);
      
      if (response.data && response.data.length > 0) {
        const chartData = response.data.map((candle: any, index: number) => {
          // Log the raw time string received for first few candles
          if (index < 3) {
            console.log(`[BitcoinChart] Raw candle ${index} time string:`, candle.time);
            console.log(`[BitcoinChart] Parsed as Date:`, new Date(candle.time));
            console.log(`[BitcoinChart] Unix timestamp:`, Math.floor(new Date(candle.time).getTime() / 1000));
          }
          
          return {
            time: Math.floor(new Date(candle.time).getTime() / 1000),
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
          };
        });
        
        // Log first and last candle times for debugging
        if (chartData.length > 0) {
          const firstDate = new Date(chartData[0].time * 1000);
          const lastDate = new Date(chartData[chartData.length - 1].time * 1000);
          console.log('[BitcoinChart] First candle:', firstDate.toISOString(), '(Local:', firstDate.toLocaleString(), ')');
          console.log('[BitcoinChart] Last candle:', lastDate.toISOString(), '(Local:', lastDate.toLocaleString(), ')');
          
          // Check if data is behind current time
          const now = new Date();
          const hoursBehind = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
          console.log('[BitcoinChart] Data is', hoursBehind.toFixed(1), 'hours behind current time');
        }
        
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

    console.log('[BitcoinTestChart] Creating chart');
    
    // Create chart - matching AdaptiveChart exactly
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
        tickMarkFormatter: (time, tickMarkType, locale) => {
          // Convert UTC timestamp to local time for axis labels
          const date = new Date(time * 1000);
          
          // Format based on the tick mark type
          if (tickMarkType === 0) { // Year
            return date.getFullYear().toString();
          } else if (tickMarkType === 1) { // Month
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return months[date.getMonth()];
          } else if (tickMarkType === 2) { // DayOfMonth
            return date.getDate().toString();
          } else if (tickMarkType === 3) { // Time
            const hours = date.getHours();
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12; // Convert 0 to 12
            return `${displayHours}:${minutes} ${ampm}`;
          } else if (tickMarkType === 4) { // TimeWithSeconds
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
        timeFormatter: (timestamp) => {
          // Convert UTC timestamp to local time (12-hour format)
          const date = new Date(timestamp * 1000);
          const hours = date.getHours();
          const minutes = date.getMinutes().toString().padStart(2, '0');
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const displayHours = hours % 12 || 12; // Convert 0 to 12
          return `${displayHours}:${minutes} ${ampm}`;
        },
        dateFormatter: (timestamp) => {
          // Convert UTC timestamp to local date
          const date = new Date(timestamp * 1000);
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          return `${month}/${day}`;
        },
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88',
      downColor: '#ff4976',
      borderVisible: false,
      wickUpColor: '#00ff88',
      wickDownColor: '#ff4976',
      priceFormat: {
        type: 'custom',
        formatter: formatBitcoinPrice,
      },
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

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
    const crosshairUnsubscribe = chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData.has(candlestickSeries)) {
        toolTip.style.display = 'none';
        return;
      }

      const data = param.seriesData.get(candlestickSeries) as any;
      const timestamp = typeof param.time === 'string' ? param.time : param.time * 1000;
      const date = new Date(timestamp);
      
      // Format date and time
      const dateStr = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
      const timeStr = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
      });
      
      toolTip.style.display = 'block';
      toolTip.innerHTML = `
        <div style="color: #999; margin-bottom: 4px">${dateStr} ${timeStr}</div>
        <div style="color: #fff">O: ${formatBitcoinPrice(data.open)}</div>
        <div style="color: #fff">H: ${formatBitcoinPrice(data.high)}</div>
        <div style="color: #fff">L: ${formatBitcoinPrice(data.low)}</div>
        <div style="color: ${data.close >= data.open ? '#00ff88' : '#ff4976'}">C: ${formatBitcoinPrice(data.close)}</div>
      `;
    });

    // Handle resize
    const handleResize = () => {
      chart.applyOptions({
        width: chartContainerRef.current!.clientWidth,
        height: chartContainerRef.current!.clientHeight
      });
    };
    
    // CRITICAL: Monitor BAR SPACING changes instead of pixel widths
    let lastBarSpacing = 13;
    
    checkIntervalRef.current = setInterval(() => {
      if (!chartRef.current || isTransitioning) return;
      
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
    }, 100); // Check every 100ms
    
    // Handle Shift key for left edge locking
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !isShiftPressed) {
        setIsShiftPressed(true);
        const timeScale = chartRef.current?.timeScale();
        if (timeScale) {
          const visibleRange = timeScale.getVisibleRange();
          if (visibleRange) {
            lockedLeftEdgeRef.current = visibleRange.from as number;
            console.log('[LOCK LEFT] Activated, locking left edge at:', new Date((visibleRange.from as number) * 1000).toISOString());
            // Disable rightBarStaysOnScroll temporarily
            timeScale.applyOptions({
              rightBarStaysOnScroll: false
            });
          }
        }
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

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
      // Unsubscribe from crosshair
      if (crosshairUnsubscribe) {
        crosshairUnsubscribe();
      }
      // Remove tooltip
      if (toolTip && toolTip.parentNode) {
        toolTip.parentNode.removeChild(toolTip);
      }
      chart.remove();
    };
  }, []); // Only create chart once

  // Initial load effect
  useEffect(() => {
    if (initialLoadDoneRef.current) {
      console.log('[BitcoinTestChart] Initial load already done, skipping');
      return;
    }
    
    let mounted = true;
    const loadInitialData = async () => {
      if (!mounted || initialLoadDoneRef.current || !seriesRef.current || !chartRef.current) return;
      
      console.log('[BitcoinTestChart] Initial load triggered');
      initialLoadDoneRef.current = true;
      
      setIsLoading(true);
      symbolRef.current = symbol;
      currentTimeframeRef.current = timeframe || '1h';
      
      try {
        // Use dynamic sliding window that includes current time
        const now = Math.floor(Date.now() / 1000);
        const to = now + (60 * 60); // 1 hour into the future for ongoing candles
        
        // Use appropriate window based on timeframe
        let from;
        if (currentTimeframeRef.current === '1m') {
          from = now - (7 * 24 * 60 * 60); // 7 days for 1m
        } else if (currentTimeframeRef.current === '5m') {
          from = now - (30 * 24 * 60 * 60); // 30 days for 5m
        } else {
          from = now - (90 * 24 * 60 * 60); // 90 days for others
        }
        const { data } = await fetchChartData(symbol, currentTimeframeRef.current, from, to);
        if (data.length > 0) {
          seriesRef.current.setData(data);
          // Generate cache key using the same from/to values we used for fetching
          const cacheKey = getCacheKey(symbol, currentTimeframeRef.current, from, to);
          setCachedCandles(cacheKey, data);
          
          // Show appropriate default view based on timeframe
          if (chartRef.current) {
            let daysToShow = 7; // Default for 1h
            
            if (currentTimeframeRef.current === '1m') daysToShow = 0.02; // ~30 minutes
            else if (currentTimeframeRef.current === '5m') daysToShow = 0.083; // ~2 hours
            else if (currentTimeframeRef.current === '15m') daysToShow = 2;
            else if (currentTimeframeRef.current === '1h') daysToShow = 7;
            else if (currentTimeframeRef.current === '4h') daysToShow = 30;
            else if (currentTimeframeRef.current === '12h') daysToShow = 60;
            
            const timeRange = daysToShow * 24 * 60 * 60;
            const endTime = data[data.length - 1].time;
            const startTime = endTime - timeRange;
            const startIndex = data.findIndex(d => d.time >= startTime);
            
            if (startIndex > 0) {
              // Extend the range slightly to the right to show space for the current candle
              const lastTime = data[data.length - 1].time;
              const extendedTime = lastTime + getTimeframeSeconds(currentTimeframeRef.current);
              
              chartRef.current.timeScale().setVisibleRange({
                from: data[startIndex].time,
                to: extendedTime as any
              });
              
              console.log('[BitcoinChart] Set visible range to include current candle space');
            }
          }
        }
      } catch (error) {
        console.error('Error loading Bitcoin chart data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
    return () => { mounted = false; };
  }, []); // Only run once on mount
  
  // Handle external timeframe changes
  useEffect(() => {
    if (timeframe && timeframe !== currentTimeframeRef.current && !isTransitioning && initialLoadDoneRef.current) {
      console.log(`[EXTERNAL] Switching to ${timeframe} from external control`);
      switchTimeframe(timeframe);
    }
  }, [timeframe]);

  // Real-time data streaming effect
  useEffect(() => {
    console.log('[BitcoinChart] Real-time streaming effect triggered');
    let mounted = true;
    let unlistenStatus: (() => void) | undefined;
    let unlistenCandle: (() => void) | undefined;

    const startStreaming = async () => {
      try {
        
        // Start the candle update monitor
        console.log('[BitcoinChart] Starting candle update monitor...');
        await invoke('start_candle_monitor');
        console.log('[BitcoinChart] Candle monitor started successfully');
        
        
        // Listen for candle update events specific to current timeframe
        const updateListener = async () => {
          // Clean up previous listener
          if (unlistenCandle) {
            unlistenCandle();
          }
          
          // Listen for updates to the current timeframe
          const eventName = `bitcoin-candles-updated-${currentTimeframeRef.current}`;
          console.log(`[BitcoinChart] Listening for ${eventName} events`);
          
          unlistenCandle = await listen<{symbol: string, timeframe: string, timestamp: string}>(eventName, (event) => {
            if (!mounted) return;
            console.log('[BitcoinChart] Candle update received:', event.payload);
            
            // Invalidate cache and reload chart data when our timeframe updates
            if (event.payload.timeframe === currentTimeframeRef.current) {
              // Invalidate cache for this timeframe
              invalidateCache(`${symbolRef.current}-${currentTimeframeRef.current}`);
              console.log('[BitcoinChart] Cache invalidated for:', currentTimeframeRef.current);
              
              // Fetch fresh data with new sliding window
              const now = Math.floor(Date.now() / 1000);
              const to = now + (60 * 60);
              
              // Use appropriate window based on timeframe
              let from;
              if (currentTimeframeRef.current === '1m') {
                from = now - (7 * 24 * 60 * 60); // 7 days for 1m
              } else if (currentTimeframeRef.current === '5m') {
                from = now - (30 * 24 * 60 * 60); // 30 days for 5m
              } else {
                from = now - (90 * 24 * 60 * 60); // 90 days for others
              }
              
              fetchChartData(symbolRef.current, currentTimeframeRef.current, from, to)
                .then(({ data }) => {
                  if (!mounted) return;
                  if (data.length > 0 && seriesRef.current) {
                    seriesRef.current.setData(data);
                    // Update cache with new key
                    const cacheKey = getCacheKey(symbolRef.current, currentTimeframeRef.current, from, to);
                    setCachedCandles(cacheKey, data);
                    console.log('[BitcoinChart] Chart updated with fresh aggregate data');
                  }
                })
                .catch(error => console.error('[BitcoinChart] Failed to reload after update:', error));
            }
          });
        };
        
        await updateListener();
        
        // Listen for connection status
        unlistenStatus = await listen<StreamStatus>('bitcoin-stream-status', (event) => {
          if (!mounted) return;
          console.log('[BitcoinChart] Stream status:', event.payload);
          setStreamStatus(event.payload);
        });
        
      } catch (error) {
        console.error('[BitcoinChart] Failed to start Bitcoin stream:', error);
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
      console.log('[BitcoinChart] Stopping candle monitor on unmount');
      invoke('stop_candle_monitor').catch(console.error);
    };
  }, []); // Only run once on mount

  // Simple periodic refresh to catch aggregate updates
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Only refresh if we have a chart and not loading
      if (chartRef.current && !isLoading) {
        console.log('[BitcoinChart] Periodic refresh check');
        
        // Use fresh sliding window for each refresh
        const now = Math.floor(Date.now() / 1000);
        const to = now + (60 * 60);
        
        // Use appropriate window based on timeframe
        let from;
        if (currentTimeframeRef.current === '1m') {
          from = now - (7 * 24 * 60 * 60); // 7 days for 1m
        } else if (currentTimeframeRef.current === '5m') {
          from = now - (30 * 24 * 60 * 60); // 30 days for 5m
        } else {
          from = now - (90 * 24 * 60 * 60); // 90 days for others
        }
        
        // Reload data
        fetchChartData(symbolRef.current, currentTimeframeRef.current, from, to)
          .then(({ data }) => {
            if (data.length > 0 && seriesRef.current) {
              // Only update if data actually changed
              const currentData = seriesRef.current.data();
              if (currentData.length === 0 || 
                  data[data.length - 1].time !== currentData[currentData.length - 1].time ||
                  data.length !== currentData.length) {
                console.log('[BitcoinChart] New data detected, updating chart');
                seriesRef.current.setData(data);
                
                // Update cache with new key
                const cacheKey = getCacheKey(symbolRef.current, currentTimeframeRef.current, from, to);
                setCachedCandles(cacheKey, data);
                
                // Update dateRangeRef for other functions
                dateRangeRef.current = { from, to };
              }
            }
          })
          .catch(error => console.error('[BitcoinChart] Periodic refresh error:', error));
      }
    }, 30000); // Every 30 seconds

    return () => clearInterval(intervalId);
  }, []); // Only create interval once

  // Countdown timer lifecycle management
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    
    const startCountdown = () => {
      // Clear any existing interval
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      
      // Initial update
      updateCountdown();
      
      // Start new interval
      intervalId = setInterval(updateCountdown, 1000);
      countdownIntervalRef.current = intervalId;
    };
    
    const stopCountdown = () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
    
    // Handle visibility changes to save resources
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopCountdown();
      } else {
        startCountdown();
      }
    };
    
    // Start countdown if page is visible
    if (!document.hidden) {
      startCountdown();
    }
    
    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      stopCountdown();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentTimeframe, updateCountdown]); // Restart when timeframe changes

  // Add the checkTimeframeSwitch function
  const checkTimeframeSwitch = (barSpacing: number) => {
    if (isTransitioning) {
      return; // Silent skip during transitions
    }

    const currentTf = currentTimeframeRef.current;
    
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
    // 15m → 5m (zooming in)
    else if (currentTf === '15m' && barSpacing > SWITCH_TO_5M_BAR_SPACING) {
      console.log(`[SWITCH] 15m bar spacing ${barSpacing} > ${SWITCH_TO_5M_BAR_SPACING} → switching to 5m`);
      switchTimeframe('5m');
    }
    // 5m → 15m (zooming out)
    else if (currentTf === '5m' && barSpacing < SWITCH_FROM_5M_BAR_SPACING) {
      console.log(`[SWITCH] 5m bar spacing ${barSpacing} < ${SWITCH_FROM_5M_BAR_SPACING} → switching to 15m`);
      switchTimeframe('15m');
    }
    // 5m → 1m (zooming in)
    else if (currentTf === '5m' && barSpacing > SWITCH_TO_1M_BAR_SPACING) {
      console.log(`[SWITCH] 5m bar spacing ${barSpacing} > ${SWITCH_TO_1M_BAR_SPACING} → switching to 1m`);
      switchTimeframe('1m');
    }
    // 1m → 5m (zooming out)
    else if (currentTf === '1m' && barSpacing < SWITCH_FROM_1M_BAR_SPACING) {
      console.log(`[SWITCH] 1m bar spacing ${barSpacing} < ${SWITCH_FROM_1M_BAR_SPACING} → switching to 5m`);
      switchTimeframe('5m');
    }
  };

  const switchTimeframe = async (newTimeframe: string) => {
    if (newTimeframe === currentTimeframeRef.current || isTransitioning) return;
    
    console.log('[ResolutionTracker] Timeframe transition:', currentTimeframeRef.current, '→', newTimeframe);
    
    // Check cooldown
    const now = Date.now();
    if (now - lastTransitionRef.current < TRANSITION_COOLDOWN) {
      console.log('[COOLDOWN] Too fast! Wait a bit...');
      return;
    }
    
    lastTransitionRef.current = now;
    setIsTransitioning(true);
    
    // Store current view before switching
    const timeScale = chartRef.current!.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    const currentBarSpacing = timeScale.options().barSpacing;
    const previousTimeframe = currentTimeframeRef.current;
    
    console.log(`[ResolutionTracker] Executing transition: ${previousTimeframe} → ${newTimeframe} at bar spacing ${currentBarSpacing}`);
    
    // Update state
    currentTimeframeRef.current = newTimeframe;
    setCurrentTimeframe(newTimeframe);
    setStoreTimeframe(newTimeframe);
    if (onTimeframeChange) {
      onTimeframeChange(newTimeframe);
    }
    
    // Start fade out
    setChartOpacity(0.2);
    
    // Wait for fade out
    await new Promise(resolve => setTimeout(resolve, 250));
    
    try {
      // Use fresh sliding window for new timeframe
      const now = Math.floor(Date.now() / 1000);
      const to = now + (60 * 60);
      
      // Use appropriate window based on new timeframe
      let from;
      if (newTimeframe === '1m') {
        from = now - (7 * 24 * 60 * 60); // 7 days for 1m
      } else if (newTimeframe === '5m') {
        from = now - (30 * 24 * 60 * 60); // 30 days for 5m
      } else {
        from = now - (90 * 24 * 60 * 60); // 90 days for others
      }
      
      // Fetch new data
      const { data } = await fetchChartData(symbolRef.current, newTimeframe, from, to);
      
      if (data.length > 0 && seriesRef.current && chartRef.current) {
        // Calculate new bar spacing
        let newBarSpacing = currentBarSpacing;
        
        if (newTimeframe === '1m' && previousTimeframe === '5m') {
          newBarSpacing = Math.max(3, currentBarSpacing / 5);
        } else if (newTimeframe === '5m' && previousTimeframe === '1m') {
          newBarSpacing = Math.min(50, currentBarSpacing * 5);
        } else if (newTimeframe === '5m' && previousTimeframe === '15m') {
          newBarSpacing = Math.max(3, currentBarSpacing / 3);
        } else if (newTimeframe === '15m' && previousTimeframe === '5m') {
          newBarSpacing = Math.min(50, currentBarSpacing * 3);
        } else if (newTimeframe === '15m' && previousTimeframe === '1h') {
          newBarSpacing = Math.max(3, currentBarSpacing / 4);
        } else if (newTimeframe === '1h' && previousTimeframe === '15m') {
          newBarSpacing = Math.min(50, currentBarSpacing * 4);
        } else if (newTimeframe === '1h' && previousTimeframe === '4h') {
          newBarSpacing = Math.max(3, currentBarSpacing / 4);
        } else if (newTimeframe === '4h' && previousTimeframe === '1h') {
          newBarSpacing = Math.min(50, currentBarSpacing * 4);
        } else if (newTimeframe === '4h' && previousTimeframe === '12h') {
          newBarSpacing = Math.max(3, currentBarSpacing / 3);
        } else if (newTimeframe === '12h' && previousTimeframe === '4h') {
          newBarSpacing = Math.min(50, currentBarSpacing * 3);
        }
        
        // Apply bar spacing before setting data
        chartRef.current.timeScale().applyOptions({
          barSpacing: newBarSpacing
        });
        
        // Set new data
        seriesRef.current.setData(data);
        // Cache with proper key using the fresh time window
        const cacheKey = getCacheKey(symbolRef.current, newTimeframe, from, to);
        setCachedCandles(cacheKey, data);
        
        // Update dateRangeRef
        dateRangeRef.current = { from, to };
        
        // Maintain view range
        if (visibleRange) {
          if (isShiftPressed && lockedLeftEdgeRef.current !== null) {
            // Keep left edge locked
            const currentDuration = (visibleRange.to as number) - (visibleRange.from as number);
            const ratio = newTimeframe === previousTimeframe ? 1 : 
              (newTimeframe === '1m' && previousTimeframe === '5m') ? 5 :
              (newTimeframe === '5m' && previousTimeframe === '1m') ? 0.2 :
              (newTimeframe === '5m' && previousTimeframe === '15m') ? 3 :
              (newTimeframe === '15m' && previousTimeframe === '5m') ? 0.33 :
              (newTimeframe === '15m' && previousTimeframe === '1h') ? 4 :
              (newTimeframe === '1h' && previousTimeframe === '15m') ? 0.25 :
              (newTimeframe === '1h' && previousTimeframe === '4h') ? 4 :
              (newTimeframe === '4h' && previousTimeframe === '1h') ? 0.25 :
              (newTimeframe === '4h' && previousTimeframe === '12h') ? 3 :
              (newTimeframe === '12h' && previousTimeframe === '4h') ? 0.33 : 1;
            
            const newDuration = currentDuration / ratio;
            const newTo = lockedLeftEdgeRef.current + newDuration;
            
            chartRef.current.timeScale().setVisibleRange({
              from: lockedLeftEdgeRef.current as any,
              to: newTo as any
            });
          } else {
            // Normal behavior
            chartRef.current.timeScale().setVisibleRange({
              from: visibleRange.from as any,
              to: visibleRange.to as any
            });
          }
        }
      }
      
      // Fade back in
      setChartOpacity(1);
      
    } catch (error) {
      console.error('Failed to switch timeframe:', error);
      setChartOpacity(1);
    } finally {
      setIsTransitioning(false);
    }
  };

  // Render fullscreen version
  if (isFullscreen) {
    return (
      <>
        {/* Fullscreen overlay */}
        <Box
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#151515',
            zIndex: 100,
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header with close button */}
          <Group justify="space-between" mb="sm">
            <Group>
              <Text size="lg" fw={500} c="white">{symbol} - {currentTimeframe} Chart</Text>
              <Badge 
                color={streamStatus.connected ? 'green' : 'red'} 
                variant="dot"
                leftSection={<IconCircleFilled size={8} />}
              >
                {streamStatus.connected ? 'LIVE' : 'OFFLINE'}
              </Badge>
              {lastTick && (
                <Text size="xs" c="dimmed">
                  Last: ${((lastTick.bid + lastTick.ask) / 2).toLocaleString()}
                </Text>
              )}
            </Group>
            {onToggleFullscreen && (
              <ActionIcon
                onClick={onToggleFullscreen}
                variant="subtle"
                color="gray"
                size="md"
                title="Exit fullscreen"
              >
                <IconMinimize size={20} />
              </ActionIcon>
            )}
          </Group>
          
          {/* Chart container */}
          <Box style={{ flex: 1, position: 'relative' }}>
            <div 
              ref={chartContainerRef} 
              style={{ 
                width: '100%',
                height: '100%',
                background: '#0a0a0a',
                position: 'relative',
                opacity: chartOpacity,
                transition: 'opacity 300ms ease-in-out',
                borderRadius: '4px'
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
          </Box>
        </Box>
        
        {/* Dark overlay backdrop */}
        <Box
          onClick={onToggleFullscreen}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 99,
            cursor: 'pointer',
          }}
        />
      </>
    );
  }

  // Regular mode with maximize button
  return (
    <Box style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Maximize button in top-right corner */}
      {onToggleFullscreen && (
        <ActionIcon
          onClick={onToggleFullscreen}
          variant="subtle"
          color="gray"
          size="sm"
          style={{
            position: 'absolute',
            top: 40,
            right: 8,
            zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.7)',
            '&:hover': {
              backgroundColor: 'rgba(0,0,0,0.9)'
            }
          }}
          title="Fullscreen"
        >
          <IconMaximize size={16} />
        </ActionIcon>
      )}
      
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
        
        {/* Countdown timer - centered at top */}
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)',
          padding: '5px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          fontFamily: 'monospace',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          pointerEvents: 'none', // Don't interfere with chart interaction
          zIndex: 5
        }}>
          <span style={{ color: '#666', fontSize: '11px' }}>Next:</span>
          <span style={{ 
            color: countdownColor,
            fontWeight: countdownColor === '#ffae00' ? 500 : 400,
            transition: 'color 0.3s ease'
          }}>
            {countdown}
          </span>
        </div>
        
        {/* Stream status indicator in bottom-right */}
        <div style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          background: 'rgba(0,0,0,0.7)',
          padding: '5px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <IconCircleFilled 
            size={8} 
            color={streamStatus.connected ? '#00ff88' : '#ff4976'} 
          />
          <span style={{ color: streamStatus.connected ? '#00ff88' : '#ff4976' }}>
            {streamStatus.connected ? 'LIVE' : 'OFFLINE'}
          </span>
          {lastTick && streamStatus.connected && (
            <span style={{ color: '#999', marginLeft: '6px' }}>
              ${((lastTick.bid + lastTick.ask) / 2).toLocaleString()}
            </span>
          )}
        </div>
        
      </div>
    </Box>
  );
};

export default BitcoinTestChart;