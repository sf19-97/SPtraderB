/**
 * Example integration of chartStateMachine with MarketDataChart
 * This shows how to refactor the component to use the state machine
 */

import React, { useEffect, useRef } from 'react';
import { useChartMachine } from './chartStateMachine';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';

// Example of how to integrate the state machine with the chart component
export const MarketDataChartWithStateMachine: React.FC = () => {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  
  // Initialize the state machine
  const { service, updateBarSpacing, setShiftPressed, setVisibleRange, notifyDataLoaded } = useChartMachine();
  
  // Subscribe to state changes
  useEffect(() => {
    const subscription = service.subscribe((state) => {
      const { context } = state;
      
      // Handle opacity changes for transitions
      if (chartContainerRef.current) {
        chartContainerRef.current.style.opacity = context.opacity.toString();
      }
      
      // Handle state-specific logic
      if (state.matches('loading')) {
        console.log('[StateMachine] Loading data...');
        // Trigger data fetch
        fetchData(context.symbol, context.currentTimeframe);
      }
      
      if (state.matches('transitioning')) {
        console.log(`[StateMachine] Transitioning from ${context.currentTimeframe} to ${context.targetTimeframe}`);
        // The actual transition is handled by the machine's invoke service
      }
      
      if (state.matches('ready')) {
        console.log('[StateMachine] Chart ready');
      }
      
      if (state.matches('error')) {
        console.error('[StateMachine] Error:', context.error);
      }
    });
    
    // Start the service
    service.start();
    
    return () => {
      subscription.unsubscribe();
      service.stop();
    };
  }, [service]);
  
  // Monitor bar spacing changes
  useEffect(() => {
    if (!chartRef.current) return;
    
    const checkInterval = setInterval(() => {
      const barSpacing = chartRef.current?.timeScale().options().barSpacing;
      if (barSpacing !== undefined) {
        updateBarSpacing(barSpacing);
      }
    }, 100);
    
    return () => clearInterval(checkInterval);
  }, [updateBarSpacing]);
  
  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(true);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setShiftPressed]);
  
  // Monitor visible range changes
  useEffect(() => {
    if (!chartRef.current) return;
    
    const timeScale = chartRef.current.timeScale();
    const unsubscribe = timeScale.subscribeVisibleTimeRangeChange(() => {
      const range = timeScale.getVisibleRange();
      if (range) {
        setVisibleRange({
          from: range.from as number,
          to: range.to as number,
        });
      }
    });
    
    return () => unsubscribe();
  }, [setVisibleRange]);
  
  // Mock data fetch function
  const fetchData = async (symbol: string, timeframe: string) => {
    try {
      // Simulate data fetch
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Notify the state machine that data is loaded
      notifyDataLoaded();
    } catch (error) {
      service.send({ type: 'DATA_ERROR', error: String(error) });
    }
  };
  
  return (
    <div 
      ref={chartContainerRef}
      style={{
        width: '100%',
        height: '100%',
        transition: 'opacity 300ms ease-in-out',
      }}
    />
  );
};

/**
 * Key integration points for MarketDataChart:
 * 
 * 1. Replace manual state management:
 *    - currentTimeframeRef → context.currentTimeframe
 *    - isTransitioningRef → state.matches('transitioning')
 *    - isShiftPressed state → context.isShiftPressed
 *    - chartOpacity state → context.opacity
 * 
 * 2. Replace manual transition logic:
 *    - checkTimeframeSwitch() → handled by state machine
 *    - switchTimeframe() → service.send('TIMEFRAME_CHANGE_REQUESTED')
 *    - Cooldown logic → built into state machine
 * 
 * 3. Benefits:
 *    - Clear state visualization
 *    - Predictable transitions
 *    - No race conditions
 *    - Easy to test
 *    - Declarative state management
 * 
 * 4. State machine handles:
 *    - Transition cooldowns
 *    - Animation timing
 *    - Bar spacing thresholds
 *    - Zoom state management
 *    - Error recovery
 * 
 * 5. Component focuses on:
 *    - Chart rendering
 *    - Data fetching
 *    - User interactions
 *    - Visual updates
 */