import { useEffect, useRef, useState, useCallback } from 'react';
import { IChartApi, Time } from 'lightweight-charts';

export interface VisibleRange {
  from: number;
  to: number;
}

export interface UseChartZoomOptions {
  onBarSpacingChange?: (barSpacing: number) => void;
  onVisibleRangeChange?: (range: VisibleRange | null) => void;
  barSpacingCheckInterval?: number;
}

export interface UseChartZoomReturn {
  visibleRange: VisibleRange | null;
  barSpacing: number;
  zoomIn: (factor?: number) => void;
  zoomOut: (factor?: number) => void;
  resetZoom: () => void;
  scrollToTime: (time: number, animate?: boolean) => void;
  setVisibleRange: (range: VisibleRange) => void;
}

/**
 * Hook to manage chart zoom functionality including:
 * - Visible range tracking
 * - Bar spacing monitoring
 * - Zoom utilities
 */
export function useChartZoom(
  chart: IChartApi | null,
  options?: UseChartZoomOptions
): UseChartZoomReturn {
  const [visibleRange, setVisibleRange] = useState<VisibleRange | null>(null);
  const [barSpacing, setBarSpacing] = useState(12);

  const barSpacingCheckInterval = options?.barSpacingCheckInterval || 100;
  const lastBarSpacingRef = useRef(12);
  const instanceId = useRef(Math.random().toString(36).substr(2, 9));
  
  // Store callbacks in refs to prevent effect re-runs
  const onBarSpacingChangeRef = useRef(options?.onBarSpacingChange);
  const onVisibleRangeChangeRef = useRef(options?.onVisibleRangeChange);
  
  // Update refs when callbacks change
  useEffect(() => {
    onBarSpacingChangeRef.current = options?.onBarSpacingChange;
    onVisibleRangeChangeRef.current = options?.onVisibleRangeChange;
  }, [options?.onBarSpacingChange, options?.onVisibleRangeChange]);


  // Track visible range changes
  useEffect(() => {
    if (!chart) return;

    console.log(`[useChartZoom ${instanceId.current}] Setting up visible range tracking`);
    
    const handleVisibleRangeChange = () => {
      const range = chart.timeScale().getVisibleRange();
      if (range) {
        const newRange = {
          from: range.from as number,
          to: range.to as number,
        };
        setVisibleRange(newRange);
        onVisibleRangeChangeRef.current?.(newRange);
      } else {
        setVisibleRange(null);
        onVisibleRangeChangeRef.current?.(null);
      }
    };

    // Initial range
    handleVisibleRangeChange();

    // Subscribe to changes
    chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange);

    return () => {
      console.log(`[useChartZoom ${instanceId.current}] Cleaning up visible range tracking`);
      try {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange);
      } catch (e) {
        console.error(`[useChartZoom ${instanceId.current}] Error unsubscribing:`, e);
      }
    };
  }, [chart]); // Remove options from deps to prevent infinite loop

  // Monitor bar spacing
  useEffect(() => {
    if (!chart) return;

    console.log(`[useChartZoom ${instanceId.current}] Starting bar spacing monitor`);
    let intervalRunning = true;
    
    const checkBarSpacing = () => {
      if (!intervalRunning) return;
      
      try {
        const currentBarSpacing = chart.timeScale().options().barSpacing;
        
        if (currentBarSpacing !== lastBarSpacingRef.current) {
          console.log(
            `[useChartZoom ${instanceId.current}] Bar spacing changed: ${lastBarSpacingRef.current} → ${currentBarSpacing}`
          );
          lastBarSpacingRef.current = currentBarSpacing;
          setBarSpacing(currentBarSpacing);
          onBarSpacingChangeRef.current?.(currentBarSpacing);
        }
      } catch (e) {
        // Chart might be disposed
        console.error(`[useChartZoom ${instanceId.current}] Error checking bar spacing:`, e);
        intervalRunning = false;
      }
    };

    // Initial check
    checkBarSpacing();
    
    const intervalId = setInterval(checkBarSpacing, barSpacingCheckInterval);

    return () => {
      console.log(`[useChartZoom ${instanceId.current}] Stopping bar spacing monitor`);
      intervalRunning = false;
      clearInterval(intervalId);
    };
  }, [chart, barSpacingCheckInterval]);

  // Zoom in
  const zoomIn = useCallback((factor = 1.2) => {
    if (!chart) return;
    
    const timeScale = chart.timeScale();
    const currentBarSpacing = timeScale.options().barSpacing;
    const newBarSpacing = Math.min(currentBarSpacing * factor, 50); // Max bar spacing
    
    timeScale.applyOptions({ barSpacing: newBarSpacing });
  }, [chart]);

  // Zoom out
  const zoomOut = useCallback((factor = 1.2) => {
    if (!chart) return;
    
    const timeScale = chart.timeScale();
    const currentBarSpacing = timeScale.options().barSpacing;
    const newBarSpacing = Math.max(currentBarSpacing / factor, 2); // Min bar spacing
    
    timeScale.applyOptions({ barSpacing: newBarSpacing });
  }, [chart]);

  // Reset zoom to fit all data
  const resetZoom = useCallback(() => {
    if (!chart) return;
    
    chart.timeScale().fitContent();
  }, [chart]);

  // Scroll to specific time
  const scrollToTime = useCallback((time: number, animate = true) => {
    if (!chart || !visibleRange) return;
    
    const duration = visibleRange.to - visibleRange.from;
    const newFrom = time - duration / 2;
    const newTo = time + duration / 2;
    
    chart.timeScale().setVisibleRange({
      from: newFrom as Time,
      to: newTo as Time,
    });
    
    if (animate) {
      chart.timeScale().scrollToRealTime();
    }
  }, [chart, visibleRange]);

  // Set visible range
  const setVisibleRangeCallback = useCallback((range: VisibleRange) => {
    if (!chart) return;
    
    chart.timeScale().setVisibleRange({
      from: range.from as Time,
      to: range.to as Time,
    });
  }, [chart]);

  return {
    visibleRange,
    barSpacing,
    zoomIn,
    zoomOut,
    resetZoom,
    scrollToTime,
    setVisibleRange: setVisibleRangeCallback,
  };
}