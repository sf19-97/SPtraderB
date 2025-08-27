import { createMachine, assign, createActor } from 'xstate';
import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useSelector } from '@xstate/react';

// Types
export interface ChartContext {
  symbol: string;
  timeframe: string;
  barSpacing: number;
  opacity: number;
  visibleRange: { from: number; to: number } | null;
  lastTransition: number;
  error: string | null;
}

export type ChartEvent =
  | { type: 'INITIALIZE'; symbol: string; timeframe: string }
  | { type: 'UPDATE_BAR_SPACING'; barSpacing: number }
  | { type: 'REQUEST_TIMEFRAME_CHANGE'; timeframe: string }
  | { type: 'SET_VISIBLE_RANGE'; range: { from: number; to: number } | null }
  | { type: 'DATA_LOADED' }
  | { type: 'DATA_ERROR'; error: string }
  | { type: 'SYMBOL_CHANGED'; symbol: string }
  | { type: 'RESIZE' }
  | { type: 'RETRY' };

export type ChartState =
  | { value: 'idle'; context: ChartContext }
  | { value: 'loading'; context: ChartContext }
  | { value: 'ready'; context: ChartContext }
  | { value: { ready: 'monitoring' | 'checkingTimeframe' }; context: ChartContext }
  | { value: 'transitioning'; context: ChartContext }
  | { value: 'error'; context: ChartContext };

// Timeframe switching thresholds (from MarketDataChart)
const SWITCH_TO_5M_BAR_SPACING = 35;
const SWITCH_FROM_5M_BAR_SPACING = 7;
const SWITCH_TO_15M_BAR_SPACING = 32;
const SWITCH_TO_1H_BAR_SPACING = 8;
const SWITCH_TO_4H_BAR_SPACING = 8;
const SWITCH_FROM_4H_BAR_SPACING = 32;
const SWITCH_TO_12H_BAR_SPACING = 4;
const SWITCH_FROM_12H_BAR_SPACING = 24;

const TRANSITION_COOLDOWN = 700; // ms

// Helper to determine if timeframe switch is needed
function shouldSwitchTimeframe(timeframe: string, barSpacing: number): string | null {
  console.log(`[shouldSwitchTimeframe] Checking: timeframe=${timeframe}, barSpacing=${barSpacing}`);
  
  // 12h → 4h (zooming in)
  if (timeframe === '12h' && barSpacing > SWITCH_FROM_12H_BAR_SPACING) {
    console.log(`[shouldSwitchTimeframe] 12h → 4h (barSpacing ${barSpacing} > ${SWITCH_FROM_12H_BAR_SPACING})`);
    return '4h';
  }
  // 4h → 12h (zooming out)
  if (timeframe === '4h' && barSpacing < SWITCH_TO_12H_BAR_SPACING) {
    console.log(`[shouldSwitchTimeframe] 4h → 12h (barSpacing ${barSpacing} < ${SWITCH_TO_12H_BAR_SPACING})`);
    return '12h';
  }
  // 4h → 1h (zooming in)
  if (timeframe === '4h' && barSpacing > SWITCH_FROM_4H_BAR_SPACING) {
    console.log(`[shouldSwitchTimeframe] 4h → 1h (barSpacing ${barSpacing} > ${SWITCH_FROM_4H_BAR_SPACING})`);
    return '1h';
  }
  // 1h → 4h (zooming out)
  if (timeframe === '1h' && barSpacing < SWITCH_TO_4H_BAR_SPACING) {
    console.log(`[shouldSwitchTimeframe] 1h → 4h (barSpacing ${barSpacing} < ${SWITCH_TO_4H_BAR_SPACING})`);
    return '4h';
  }
  // 1h → 15m (zooming in)
  if (timeframe === '1h' && barSpacing > SWITCH_TO_15M_BAR_SPACING) {
    console.log(`[shouldSwitchTimeframe] 1h → 15m (barSpacing ${barSpacing} > ${SWITCH_TO_15M_BAR_SPACING})`);
    return '15m';
  }
  // 15m → 1h (zooming out)
  if (timeframe === '15m' && barSpacing < SWITCH_TO_1H_BAR_SPACING) {
    console.log(`[shouldSwitchTimeframe] 15m → 1h (barSpacing ${barSpacing} < ${SWITCH_TO_1H_BAR_SPACING})`);
    return '1h';
  }
  // 15m → 5m (zooming in)
  if (timeframe === '15m' && barSpacing > SWITCH_TO_5M_BAR_SPACING) {
    console.log(`[shouldSwitchTimeframe] 15m → 5m (barSpacing ${barSpacing} > ${SWITCH_TO_5M_BAR_SPACING})`);
    return '5m';
  }
  // 5m → 15m (zooming out)
  if (timeframe === '5m' && barSpacing < SWITCH_FROM_5M_BAR_SPACING) {
    console.log(`[shouldSwitchTimeframe] 5m → 15m (barSpacing ${barSpacing} < ${SWITCH_FROM_5M_BAR_SPACING})`);
    return '15m';
  }

  console.log(`[shouldSwitchTimeframe] No transition needed`);
  return null;
}

// The state machine
export const chartMachine = createMachine({
  id: 'chart',
  initial: 'loading', // Start in loading state since we have initial context
  types: {} as {
    context: ChartContext;
    events: ChartEvent;
    input: Partial<ChartContext>;
  },
  context: ({ input }) => ({
    symbol: input?.symbol || 'EURUSD',
    timeframe: input?.timeframe || '1h',
    barSpacing: input?.barSpacing || 12,
    opacity: 1,
    visibleRange: null,
    lastTransition: 0,
    error: null,
  }),
  states: {
    idle: {
      on: {
        INITIALIZE: {
          target: 'loading',
          actions: [
            ({ event }) => console.log(`[StateMachine] INITIALIZE received: symbol=${event?.symbol}, timeframe=${event?.timeframe}`),
            assign({
              symbol: ({ event }) => event?.symbol || '',
              timeframe: ({ event }) => event?.timeframe || '1h',
            }),
          ],
        },
      },
    },
    loading: {
      entry: [
        () => console.log('[StateMachine] Entering LOADING state'),
        assign({ opacity: 0.5 })
      ],
      on: {
        DATA_LOADED: {
          target: 'ready',
          actions: assign({ error: null }),
        },
        DATA_ERROR: {
          target: 'error',
          actions: assign({ error: ({ event }) => event?.error || 'Unknown error' }),
        },
      },
    },
    ready: {
      entry: [
        () => console.log('[StateMachine] Entering READY state'),
        assign({ opacity: 1 })
      ],
      type: 'parallel',
      states: {
        monitoring: {
          initial: 'active',
          states: {
            active: {
              on: {
                UPDATE_BAR_SPACING: {
                  target: 'checkingTimeframe',
                  actions: [
                    ({ event }) => console.log(`[StateMachine] UPDATE_BAR_SPACING received: ${event?.barSpacing}`),
                    assign({ barSpacing: ({ event }) => event?.barSpacing || 12 }),
                  ],
                },
              },
            },
            checkingTimeframe: {
              entry: () => console.log('[StateMachine] Entering checkingTimeframe state'),
              always: [
                {
                  target: '#chart.transitioning',
                  guard: ({ context }) => {
                    const now = Date.now();
                    const timeSinceLastTransition = now - context.lastTransition;
                    console.log(`[StateMachine] Guard check: timeSinceLastTransition=${timeSinceLastTransition}ms, cooldown=${TRANSITION_COOLDOWN}ms`);
                    
                    if (timeSinceLastTransition < TRANSITION_COOLDOWN) {
                      console.log('[StateMachine] Cooldown active, skipping transition');
                      return false;
                    }
                    
                    const newTimeframe = shouldSwitchTimeframe(context.timeframe, context.barSpacing);
                    console.log(`[StateMachine] Guard result: newTimeframe=${newTimeframe}`);
                    return newTimeframe !== null;
                  },
                  actions: assign({
                    timeframe: ({ context }) => shouldSwitchTimeframe(context.timeframe, context.barSpacing)!,
                    lastTransition: () => Date.now(),
                  }),
                },
                {
                  target: 'active',
                },
              ],
            },
          },
        },
      },
      on: {
        REQUEST_TIMEFRAME_CHANGE: {
          target: 'transitioning',
          guard: ({ context, event }) => {
            const now = Date.now();
            return (
              now - context.lastTransition >= TRANSITION_COOLDOWN &&
              event?.timeframe !== context.timeframe
            );
          },
          actions: assign({
            timeframe: ({ event }) => event?.timeframe || '1h',
            lastTransition: () => Date.now(),
          }),
        },
        SYMBOL_CHANGED: {
          target: 'loading',
          actions: assign({ symbol: ({ event }) => event?.symbol || '' }),
        },
        SET_VISIBLE_RANGE: {
          actions: assign({ visibleRange: ({ event }) => event?.range || null }),
        },
        RESIZE: {
          // Handle resize without state change
          actions: () => console.log('[ChartStateMachine] Window resized'),
        },
      },
    },
    transitioning: {
      entry: [
        ({ context }) => console.log(`[StateMachine] Entering transitioning state, new timeframe: ${context.timeframe}`),
        assign({ opacity: 0.2 }),
      ],
      after: {
        250: 'loading', // Wait for fade out animation
      },
    },
    error: {
      entry: assign({ opacity: 0.5 }),
      after: {
        // Auto-retry after 5 seconds
        5000: {
          target: 'loading',
          actions: assign({ error: null }),
        },
      },
      on: {
        INITIALIZE: {
          target: 'loading',
          actions: assign({
            symbol: ({ event }) => event?.symbol || '',
            timeframe: ({ event }) => event?.timeframe || '1h',
            error: () => null,
          }),
        },
        // Allow manual retry
        RETRY: {
          target: 'loading',
          actions: assign({ error: null }),
        },
      },
    },
  },
});

// React hook for using the state machine
export function useChartMachine(initialContext?: Partial<ChartContext>) {
  const machineId = useRef(Math.random().toString(36).substr(2, 9));
  
  const service = useMemo(() => {
    console.log(`[ChartMachine ${machineId.current}] Creating state machine`);
    // XState v5 uses createActor
    const actor = createActor(chartMachine, {
      input: initialContext || {}
    });
    actor.start();
    return actor;
  }, []); // Empty deps - we only create once

  useEffect(() => {
    console.log(`[ChartMachine ${machineId.current}] Service started`);
    return () => {
      // Don't stop in development to handle React StrictMode double mounting
      if (process.env.NODE_ENV === 'production') {
        console.log(`[ChartMachine ${machineId.current}] Stopping service`);
        service.stop();
      } else {
        console.log(`[ChartMachine ${machineId.current}] Keeping service alive in development`);
      }
    };
  }, [service]);

  const initialize = useCallback(
    (symbol: string, timeframe: string) => {
      console.log(`[ChartMachine ${machineId.current}] initialize() called with symbol=${symbol}, timeframe=${timeframe}`);
      // Check if the actor is running before sending events
      if (service.getSnapshot().status === 'active') {
        service.send({ type: 'INITIALIZE', symbol, timeframe });
      } else {
        console.warn(`[ChartMachine ${machineId.current}] Actor is not active, cannot initialize`);
      }
    },
    [service]
  );

  const updateBarSpacing = useCallback(
    (barSpacing: number) => {
      console.log(`[ChartMachine ${machineId.current}] Sending UPDATE_BAR_SPACING: ${barSpacing}`);
      service.send({ type: 'UPDATE_BAR_SPACING', barSpacing });
    },
    [service]
  );

  const requestTimeframeChange = useCallback(
    (timeframe: string) => {
      service.send({ type: 'REQUEST_TIMEFRAME_CHANGE', timeframe });
    },
    [service]
  );

  const setVisibleRange = useCallback(
    (range: { from: number; to: number } | null) => {
      service.send({ type: 'SET_VISIBLE_RANGE', range });
    },
    [service]
  );

  const notifyDataLoaded = useCallback(() => {
    service.send({ type: 'DATA_LOADED' });
  }, [service]);

  const notifyDataError = useCallback(
    (error: string) => {
      service.send({ type: 'DATA_ERROR', error });
    },
    [service]
  );

  const notifySymbolChanged = useCallback(
    (symbol: string) => {
      service.send({ type: 'SYMBOL_CHANGED', symbol });
    },
    [service]
  );

  const notifyResize = useCallback(() => {
    service.send({ type: 'RESIZE' });
  }, [service]);

  const retry = useCallback(() => {
    service.send({ type: 'RETRY' });
  }, [service]);

  return {
    service,
    initialize,
    updateBarSpacing,
    requestTimeframeChange,
    setVisibleRange,
    notifyDataLoaded,
    notifyDataError,
    notifySymbolChanged,
    notifyResize,
    retry,
  };
}