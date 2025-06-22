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

interface MetadataCache {
  [symbol: string]: {
    from: number
    to: number
    timestamp: number
  }
}

interface ChartState {
  // Cache
  candleCache: Map<string, CachedData>
  viewStates: Map<string, ViewState>
  metadataCache: MetadataCache
  
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
  
  // Metadata cache actions
  getCachedMetadata: (symbol: string) => { from: number; to: number } | null
  setCachedMetadata: (symbol: string, from: number, to: number) => void
  
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
      metadataCache: {},
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
          console.log('[ChartStore] Current cache keys:', Array.from(get().candleCache.keys()))
          return null
        }
        
        // Check if expired
        const now = Date.now()
        const age = now - cached.timestamp
        if (age > CACHE_TTL) {
          console.log('[ChartStore] Cache expired for:', key, {
            age: `${(age/1000).toFixed(0)}s`,
            ttl: `${(CACHE_TTL/1000).toFixed(0)}s`,
            cachedAt: new Date(cached.timestamp).toISOString(),
            now: new Date(now).toISOString()
          })
          // Remove expired entry
          const newCache = new Map(get().candleCache)
          newCache.delete(key)
          set({ candleCache: newCache })
          return null
        }
        
        console.log('[ChartStore] Cache hit for:', key, `(${cached.candles.length} candles, age: ${(age/1000).toFixed(0)}s)`)
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
      },
      
      // Get cached metadata
      getCachedMetadata: (symbol) => {
        const cached = get().metadataCache[symbol]
        if (!cached) {
          console.log('[ChartStore] Metadata cache miss for:', symbol, 'Available keys:', Object.keys(get().metadataCache))
          return null
        }
        
        // Check if expired
        const now = Date.now()
        const age = now - cached.timestamp
        if (age > CACHE_TTL) {
          console.log('[ChartStore] Metadata cache expired for:', symbol, `age: ${(age/1000).toFixed(0)}s`)
          // Remove expired entry
          const newCache = { ...get().metadataCache }
          delete newCache[symbol]
          set({ metadataCache: newCache })
          return null
        }
        
        console.log('[ChartStore] Metadata cache hit for:', symbol)
        return { from: cached.from, to: cached.to }
      },
      
      // Set cached metadata
      setCachedMetadata: (symbol, from, to) => {
        const newCache = {
          ...get().metadataCache,
          [symbol]: {
            from,
            to,
            timestamp: Date.now()
          }
        }
        console.log('[ChartStore] Cached metadata for:', symbol, { from, to })
        set({ metadataCache: newCache })
      }
    }),
    {
      name: 'chart-store'
    }
  )
)