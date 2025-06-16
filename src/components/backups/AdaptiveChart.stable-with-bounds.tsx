import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { invoke } from '@tauri-apps/api/core';

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
  const [isLoading, setIsLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [dataTimeRange, setDataTimeRange] = useState<{ start: number; end: number } | null>(null);
  
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
        precision: 5,
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
    const checkInterval = setInterval(() => {
      if (!isTransitioning && chartRef.current) {
        const currentBarSpacing = chartRef.current.timeScale().options().barSpacing;
        
        if (currentBarSpacing !== lastBarSpacing) {
          console.log(`[SPACING] ${currentTimeframeRef.current}: bar spacing = ${currentBarSpacing}`);
          lastBarSpacing = currentBarSpacing;
          checkTimeframeSwitch(currentBarSpacing);
        }
      }
    }, 100); // Check every 100ms

    // Load initial data
    loadData(currentTimeframeRef.current);

    return () => {
      clearInterval(checkInterval);
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Handle external timeframe changes from buttons
  useEffect(() => {
    if (timeframe && timeframe !== currentTimeframeRef.current && !isTransitioning) {
      console.log(`[EXTERNAL] Switching to ${timeframe} from button`);
      switchTimeframe(timeframe);
    }
  }, [timeframe]);

  const checkTimeframeSwitch = (barSpacing: number) => {
    if (isTransitioning) return;

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
  };

  const switchTimeframe = async (newTimeframe: string) => {
    if (newTimeframe === currentTimeframeRef.current || isTransitioning) return;
    
    setIsTransitioning(true);
    
    // Store current view before switching
    const timeScale = chartRef.current!.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    const currentBarSpacing = timeScale.options().barSpacing;
    const previousTimeframe = currentTimeframeRef.current; // Store this BEFORE updating
    
    console.log(`[TRANSITION] ${currentTimeframeRef.current} → ${newTimeframe} at bar spacing ${currentBarSpacing}`);
    
    currentTimeframeRef.current = newTimeframe;
    setCurrentTimeframe(newTimeframe);
    if (onTimeframeChange) {
      onTimeframeChange(newTimeframe);
    }
    
    await loadDataAndMaintainView(newTimeframe, visibleRange, currentBarSpacing, previousTimeframe);
    
    setIsTransitioning(false);
  };

  const loadData = async (timeframe: string) => {
    setIsLoading(true);
    
    try {
      const data = await invoke<ChartData[]>('fetch_candles', {
        request: {
          symbol: symbol,
          timeframe: timeframe,
          from: 1704153600, // Jan 2, 2024
          to: 1733011200,   // Nov 30, 2024
        },
      });

      if (!data || !seriesRef.current) return;

      const formattedData = data.map(candle => ({
        time: candle.time as any,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      seriesRef.current.setData(formattedData);
      
      // Capture the actual data bounds
      if (formattedData.length > 0) {
        const firstCandle = formattedData[0].time;
        const lastCandle = formattedData[formattedData.length - 1].time;
        setDataTimeRange({ start: firstCandle, end: lastCandle });
        
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
      
      console.log(`[LOADED] ${timeframe}: ${data.length} candles`);
      
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDataAndMaintainView = async (timeframe: string, visibleRange: any, previousBarSpacing: number, previousTimeframe: string) => {
    setIsLoading(true);
    
    try {
      const data = await invoke<ChartData[]>('fetch_candles', {
        request: {
          symbol: symbol,
          timeframe: timeframe,
          from: 1704153600,
          to: 1733011200,
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
      
      // Update data bounds
      if (formattedData.length > 0) {
        const firstCandle = formattedData[0].time;
        const lastCandle = formattedData[formattedData.length - 1].time;
        setDataTimeRange({ start: firstCandle, end: lastCandle });
      }
      
      // Set the visible range immediately after data
      if (visibleRange) {
        chartRef.current.timeScale().setVisibleRange({
          from: visibleRange.from as any,
          to: visibleRange.to as any
        });
      }
      
      console.log(`[LOADED] ${timeframe}: ${data.length} candles (maintained view)`);
      
    } catch (error) {
      console.error('Failed to load data:', error);
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
        position: 'relative'
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
      </div>
      
      {/* Data bounds indicator */}
      {dataTimeRange && (
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          background: 'rgba(0,0,0,0.7)',
          color: '#666',
          padding: '3px 8px',
          borderRadius: '4px',
          fontSize: '10px',
          fontFamily: 'monospace'
        }}>
          Data: {new Date(dataTimeRange.start * 1000).toLocaleDateString()} - {new Date(dataTimeRange.end * 1000).toLocaleDateString()}
        </div>
      )}
    </div>
  );
};

export default AdaptiveChart;