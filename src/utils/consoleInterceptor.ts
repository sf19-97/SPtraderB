// Utility to intercept console logs and extract timeframe information
type TimeframeListener = (timeframe: string) => void;

class ConsoleInterceptor {
  private listeners: Set<TimeframeListener> = new Set();
  private originalLog: typeof console.log;
  private currentTimeframe: string = '1h'; // Default timeframe
  private isIntercepting: boolean = false;

  constructor() {
    this.originalLog = console.log;
  }

  start() {
    if (this.isIntercepting) return;

    this.isIntercepting = true;
    console.log = (...args: any[]) => {
      // Call original console.log
      this.originalLog.apply(console, args);

      // Check for timeframe-related logs
      const message = args.join(' ');
      this.parseTimeframeFromLog(message);
    };
  }

  stop() {
    if (!this.isIntercepting) return;

    console.log = this.originalLog;
    this.isIntercepting = false;
  }

  private parseTimeframeFromLog(message: string) {
    let newTimeframe: string | null = null;

    // Pattern 1: [TRANSITION] 1h → 15m
    const transitionMatch = message.match(/\[TRANSITION\]\s+\S+\s+→\s+(\S+)/);
    if (transitionMatch) {
      newTimeframe = transitionMatch[1];
    }

    // Pattern 2: [SWITCH] ... switching to 15m
    const switchMatch = message.match(/\[SWITCH\].*switching to (\S+)/);
    if (switchMatch) {
      newTimeframe = switchMatch[1];
    }

    // Pattern 3: [EXTERNAL] Switching to 4h from button
    const externalMatch = message.match(/\[EXTERNAL\]\s+Switching to (\S+)/);
    if (externalMatch) {
      newTimeframe = externalMatch[1];
    }

    // Pattern 4: [ResolutionTracker] Loaded 1h: X candles
    const resolutionLoadedMatch = message.match(
      /\[ResolutionTracker\]\s+Loaded\s+(\S+):\s+\d+\s+candles/
    );
    if (resolutionLoadedMatch && !message.includes('maintained view')) {
      const potentialTf = resolutionLoadedMatch[1];
      if (['15m', '1h', '4h', '12h'].includes(potentialTf)) {
        newTimeframe = potentialTf;
      }
    }

    // Pattern 5: [ResolutionTracker] Timeframe transition: X → Y
    const resolutionTransitionMatch = message.match(
      /\[ResolutionTracker\]\s+Timeframe transition:\s+\S+\s+→\s+(\S+)/
    );
    if (resolutionTransitionMatch) {
      newTimeframe = resolutionTransitionMatch[1];
    }

    // Pattern 6: [AdaptiveChart] Initial load triggered
    const initialLoadMatch = message.match(/\[AdaptiveChart\]\s+Initial load.*timeframe:\s+(\S+)/);
    if (initialLoadMatch) {
      const potentialTf = initialLoadMatch[1];
      if (['15m', '1h', '4h', '12h'].includes(potentialTf)) {
        newTimeframe = potentialTf;
      }
    }

    // If we found a new timeframe, update and notify listeners
    if (newTimeframe && newTimeframe !== this.currentTimeframe) {
      this.currentTimeframe = newTimeframe;
      this.notifyListeners(newTimeframe);
    }
  }

  private notifyListeners(timeframe: string) {
    this.listeners.forEach((listener) => {
      try {
        listener(timeframe);
      } catch (error) {
        this.originalLog('Error in timeframe listener:', error);
      }
    });
  }

  subscribe(listener: TimeframeListener) {
    this.listeners.add(listener);
    // Immediately call with current timeframe
    listener(this.currentTimeframe);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  getCurrentTimeframe(): string {
    return this.currentTimeframe;
  }
}

// Create singleton instance
export const consoleInterceptor = new ConsoleInterceptor();
