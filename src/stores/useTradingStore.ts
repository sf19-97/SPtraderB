import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface CatalogSymbol {
  symbol: string;
  earliest: number;
  latest: number;
  tick_count: number;
}

interface TradingState {
  // Chart settings (from TradingContext)
  selectedPair: string;
  selectedTimeframe: string;
  chartType: 'candlestick' | 'line' | 'bar';
  chartVersion: 'v1' | 'v2';

  // Indicators
  indicators: {
    ma: boolean;
    rsi: boolean;
    macd: boolean;
    volume: boolean;
  };

  // Catalog cache (not persisted - fresh on reload)
  catalog: {
    symbols: CatalogSymbol[];
    timeframes: string[];
    loading: boolean;
    error: string | null;
    lastFetched: number | null;
  };

  // Actions
  setPair: (pair: string) => void;
  setTimeframe: (tf: string) => void;
  setChartType: (type: 'candlestick' | 'line' | 'bar') => void;
  setChartVersion: (version: 'v1' | 'v2') => void;
  toggleIndicator: (indicator: keyof TradingState['indicators']) => void;
  fetchCatalog: () => Promise<void>;
}

export const useTradingStore = create<TradingState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state - matches TradingContext defaults
        selectedPair: 'EURUSD',
        selectedTimeframe: '1h',
        chartType: 'candlestick',
        chartVersion: 'v1',
        indicators: {
          ma: false,
          rsi: false,
          macd: false,
          volume: false,
        },

        // Catalog cache - initially empty
        catalog: {
          symbols: [],
          timeframes: [],
          loading: false,
          error: null,
          lastFetched: null,
        },

        // Actions - same API as TradingContext
        setPair: (pair) => {
          set((_state) => {
            return { selectedPair: pair };
          });
        },

        setTimeframe: (timeframe) => {
          set({ selectedTimeframe: timeframe });
        },

        setChartType: (chartType) => {
          set({ chartType });
        },

        setChartVersion: (chartVersion) => {
          set({ chartVersion });
        },

        toggleIndicator: (indicator) => {
          set((state) => ({
            indicators: {
              ...state.indicators,
              [indicator]: !state.indicators[indicator],
            },
          }));
        },

        // Fetch catalog data from API (cached)
        fetchCatalog: async () => {
          const { catalog } = get();

          // Skip if already fetched within last 5 minutes
          if (catalog.lastFetched && Date.now() - catalog.lastFetched < 5 * 60 * 1000) {
            console.log('[TradingStore] Using cached catalog data');
            return;
          }

          // Skip if already loading
          if (catalog.loading) {
            console.log('[TradingStore] Catalog fetch already in progress');
            return;
          }

          set((state) => ({
            catalog: { ...state.catalog, loading: true, error: null },
          }));

          try {
            const marketDataUrl = import.meta.env.VITE_MARKET_DATA_API_URL || 'https://ws-market-data-server.fly.dev';
            const response = await fetch(`${marketDataUrl}/api/metadata`);

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.symbols || !Array.isArray(data.symbols)) {
              throw new Error('Invalid catalog response');
            }

            set((state) => ({
              catalog: {
                ...state.catalog,
                symbols: data.symbols || [],
                timeframes: data.timeframes || [],
                loading: false,
                error: null,
                lastFetched: Date.now(),
              },
            }));

            console.log('[TradingStore] Catalog fetched:', data.symbols.length, 'symbols');
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to fetch catalog';
            console.error('[TradingStore] Error fetching catalog:', errorMessage);

            set((state) => ({
              catalog: {
                ...state.catalog,
                loading: false,
                error: errorMessage,
              },
            }));
          }
        },
      }),
      {
        name: 'trading-storage',
        // Only persist user preferences, not UI state
        partialize: (state) => ({
          selectedPair: state.selectedPair,
          selectedTimeframe: state.selectedTimeframe,
          chartType: state.chartType,
          chartVersion: state.chartVersion,
          indicators: state.indicators,
        }),
      }
    ),
    {
      name: 'trading-store',
    }
  )
);

// Compatibility hook to ease migration
export const useTrading = () => {
  const state = useTradingStore();
  return {
    ...state,
    // Ensure complete compatibility with TradingContext API
    setTimeframe: state.setTimeframe,
  };
};
