import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

interface CachedData {
  candles: Candle[]
  timestamp: number
}

interface ViewState {
  timeframe: string
  visibleFrom: number
  visibleTo: number
  barSpacing: number
}

interface ChartState {
  // Cache
  candleCache: Map<string, CachedData>
  viewStates: Map<string, ViewState>
  
  // Current state
  isLoading: boolean
  currentSymbol: string
  currentTimeframe: string
  
  // Actions
  setLoading: (loading: boolean) => void
  setCurrentSymbol: (symbol: string) => void
  setCurrentTimeframe: (timeframe: string) => void
  
  // Cache actions
  getCachedCandles: (key: string) => Candle[] | null
  setCachedCandles: (key: string, candles: Candle[]) => void
  invalidateCache: (pattern?: string) => void
  
  // View state actions
  saveViewState: (symbol: string, state: ViewState) => void
  getViewState: (symbol: string) => ViewState | null
  
  // Utility
  getCacheKey: (symbol: string, timeframe: string, from: number, to: number) => string
}

const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

export const useChartStore = create<ChartState>()(
  devtools(
    (set, get) => ({
      // Initial state
      candleCache: new Map(),
      viewStates: new Map(),
      isLoading: false,
      currentSymbol: 'EURUSD',
      currentTimeframe: '1h',
      
      // Basic setters
      setLoading: (loading) => set({ isLoading: loading }),
      setCurrentSymbol: (symbol) => set({ currentSymbol: symbol }),
      setCurrentTimeframe: (timeframe) => set({ currentTimeframe: timeframe }),
      
      // Cache key generator
      getCacheKey: (symbol, timeframe, from, to) => {
        return `${symbol}-${timeframe}-${from}-${to}`
      },
      
      // Get cached candles
      getCachedCandles: (key) => {
        const cached = get().candleCache.get(key)
        if (!cached) {
          console.log('[ChartStore] Cache miss for:', key)
          return null
        }
        
        // Check if expired
        const now = Date.now()
        const age = now - cached.timestamp
        if (age > CACHE_TTL) {
          console.log('[ChartStore] Cache expired for:', key, `age: ${(age/1000).toFixed(0)}s, TTL: ${(CACHE_TTL/1000).toFixed(0)}s`)
          // Remove expired entry
          const newCache = new Map(get().candleCache)
          newCache.delete(key)
          set({ candleCache: newCache })
          return null
        }
        
        console.log('[ChartStore] Cache hit for:', key, `(${cached.candles.length} candles)`)
        return cached.candles
      },
      
      // Set cached candles
      setCachedCandles: (key, candles) => {
        const newCache = new Map(get().candleCache)
        
        // Simple LRU: if cache is too big, remove oldest
        if (newCache.size >= 20) {
          const oldestKey = Array.from(newCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0]
          newCache.delete(oldestKey)
          console.log('[ChartStore] Cache eviction, removed:', oldestKey)
        }
        
        newCache.set(key, {
          candles,
          timestamp: Date.now()
        })
        
        console.log('[ChartStore] Cached', candles.length, 'candles for:', key)
        set({ candleCache: newCache })
      },
      
      // Invalidate cache
      invalidateCache: (pattern) => {
        const cache = get().candleCache
        if (!pattern) {
          console.log('[ChartStore] Clearing entire cache')
          set({ candleCache: new Map() })
          return
        }
        
        const newCache = new Map(cache)
        let removed = 0
        
        cache.forEach((_, key) => {
          if (key.includes(pattern)) {
            newCache.delete(key)
            removed++
          }
        })
        
        console.log(`[ChartStore] Invalidated ${removed} cache entries matching:`, pattern)
        set({ candleCache: newCache })
      },
      
      // Save view state
      saveViewState: (symbol, state) => {
        const newViewStates = new Map(get().viewStates)
        newViewStates.set(symbol, state)
        console.log('[ChartStore] Saved view state for:', symbol, state)
        set({ viewStates: newViewStates })
      },
      
      // Get view state
      getViewState: (symbol) => {
        const state = get().viewStates.get(symbol)
        if (state) {
          console.log('[ChartStore] Retrieved view state for:', symbol, state)
        }
        return state || null
      }
    }),
    {
      name: 'chart-store'
    }
  )
)