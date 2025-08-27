import { useEffect, useRef, RefObject, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ChartOptions,
  DeepPartial,
  CandlestickSeriesOptions,
  CandlestickSeries,
} from 'lightweight-charts';

export interface ChartTheme {
  backgroundColor: string;
  textColor: string;
  gridColor: string;
  borderColor: string;
  upColor: string;
  downColor: string;
  wickUpColor: string;
  wickDownColor: string;
}

// Default dark theme
export const darkTheme: ChartTheme = {
  backgroundColor: '#0d0d0d',
  textColor: '#d1d4dc',
  gridColor: 'rgba(42, 46, 57, 0.6)',
  borderColor: '#2a2e39',
  upColor: '#26a69a',
  downColor: '#ef5350',
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
};

// Default chart options
export const defaultChartOptions = (theme: ChartTheme): DeepPartial<ChartOptions> => ({
  layout: {
    background: { color: theme.backgroundColor },
    textColor: theme.textColor,
  },
  grid: {
    vertLines: { color: theme.gridColor },
    horzLines: { color: theme.gridColor },
  },
  crosshair: {
    mode: 1, // Magnet mode
    vertLine: {
      color: theme.gridColor,
      width: 1,
      style: 3, // Dashed
      labelBackgroundColor: theme.borderColor,
    },
    horzLine: {
      color: theme.gridColor,
      width: 1,
      style: 3, // Dashed
      labelBackgroundColor: theme.borderColor,
    },
  },
  rightPriceScale: {
    borderColor: theme.borderColor,
    scaleMargins: {
      top: 0.1,
      bottom: 0.2,
    },
  },
  timeScale: {
    borderColor: theme.borderColor,
    timeVisible: true,
    secondsVisible: false,
    rightBarStaysOnScroll: true,
    barSpacing: 12,
    minBarSpacing: 2,
    fixRightEdge: false,
    fixLeftEdge: false,
    lockVisibleTimeRangeOnResize: false,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: false,
  },
  handleScale: {
    axisPressedMouseMove: {
      time: true,
      price: true,
    },
    axisDoubleClickReset: true,
    mouseWheel: true,
    pinch: true,
  },
});

// Default series options
export const defaultSeriesOptions = (theme: ChartTheme): DeepPartial<CandlestickSeriesOptions> => ({
  upColor: theme.upColor,
  downColor: theme.downColor,
  borderVisible: false,
  wickUpColor: theme.wickUpColor,
  wickDownColor: theme.wickDownColor,
  priceFormat: {
    type: 'price',
    precision: 5,
    minMove: 0.00001,
  },
  priceScaleId: 'right',
  lastValueVisible: true,
  priceLineVisible: true,
});

export interface UseChartSetupOptions {
  theme?: ChartTheme;
  chartOptions?: DeepPartial<ChartOptions>;
  seriesOptions?: DeepPartial<CandlestickSeriesOptions>;
}

export interface UseChartSetupReturn {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  isReady: boolean;
}

/**
 * Hook to setup and manage a TradingView Lightweight Chart
 * 
 * @param containerRef - Reference to the container element
 * @param options - Optional theme and configuration options
 * @returns Chart and series references
 */
export function useChartSetup(
  containerRef: RefObject<HTMLDivElement>,
  options?: UseChartSetupOptions
): UseChartSetupReturn {
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [series, setSeries] = useState<ISeriesApi<'Candlestick'> | null>(null);
  const [isReady, setIsReady] = useState(false);

  const theme = options?.theme || darkTheme;
  const chartOptions = options?.chartOptions || {};
  const seriesOptions = options?.seriesOptions || {};

  useEffect(() => {
    if (!containerRef.current) return;

    console.log('[useChartSetup] Creating chart');
    let mounted = true;

    // Create chart with merged options
    const newChart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      ...defaultChartOptions(theme),
      ...chartOptions,
    });

    // Add candlestick series with merged options
    const newSeries = newChart.addSeries(CandlestickSeries, {
      ...defaultSeriesOptions(theme),
      ...seriesOptions,
    });

    // Update state
    setChart(newChart);
    setSeries(newSeries);
    
    // Small delay to ensure chart is fully initialized
    requestAnimationFrame(() => {
      if (mounted) {
        setIsReady(true);
        console.log('[useChartSetup] Chart created successfully');
      }
    });

    // Cleanup
    return () => {
      mounted = false;
      console.log('[useChartSetup] Cleaning up chart');
      // Clear state before removing to prevent access to disposed objects
      setChart(null);
      setSeries(null);
      setIsReady(false);
      // Small delay to allow other effects to clean up first
      setTimeout(() => {
        try {
          newChart.remove();
        } catch (e) {
          console.warn('[useChartSetup] Chart already removed');
        }
      }, 0);
    };
  }, []); // Only create chart once

  // Handle container resize
  useEffect(() => {
    if (!chart || !containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && chart) {
        try {
          const { width, height } = entry.contentRect;
          chart.applyOptions({ width, height });
        } catch (e) {
          // Chart might be disposed
          console.warn('[useChartSetup] Chart disposed, cannot resize');
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [chart]);

  return {
    chart,
    series,
    isReady,
  };
}