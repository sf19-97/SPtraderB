# Zustand State Management Architecture for SPtraderB

## Overview

This document outlines a scalable state management architecture using Zustand for the SPtraderB trading application. Zustand provides a lightweight, TypeScript-first solution that can grow with the application's needs while maintaining performance and developer experience.

## Why Zustand?

- **Lightweight**: ~8KB bundle size
- **TypeScript-first**: Excellent type inference
- **No boilerplate**: Simple API
- **React DevTools**: Built-in debugging
- **Persistence**: Easy localStorage/sessionStorage integration
- **Performance**: Minimal re-renders with selector pattern

## Architecture Overview

### Store Structure
```
/src/stores/
  ├── index.ts           # Re-export all stores
  ├── useAppStore.ts     # Global app state
  ├── useChartStore.ts   # Chart-specific state & cache
  ├── useTradingStore.ts # Trading data, orders, positions
  └── useBuildStore.ts   # Build/IDE state
```

## Core Store Implementations

### 1. App Store (Global State)

```typescript
// src/stores/useAppStore.ts
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  message: string
  timestamp: number
}

interface AppState {
  // User preferences
  theme: 'light' | 'dark'
  language: string
  sidebarCollapsed: boolean
  
  // App status
  isLoading: boolean
  dbConnected: boolean
  notifications: Notification[]
  
  // Actions
  setTheme: (theme: 'light' | 'dark') => void
  toggleSidebar: () => void
  setDbConnected: (connected: boolean) => void
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void
  removeNotification: (id: string) => void
}

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        // State
        theme: 'dark',
        language: 'en',
        sidebarCollapsed: false,
        isLoading: false,
        dbConnected: false,
        notifications: [],
        
        // Actions
        setTheme: (theme) => set({ theme }),
        toggleSidebar: () => set((state) => ({ 
          sidebarCollapsed: !state.sidebarCollapsed 
        })),
        setDbConnected: (connected) => set({ dbConnected: connected }),
        addNotification: (notification) => set((state) => ({
          notifications: [...state.notifications, {
            ...notification,
            id: crypto.randomUUID(),
            timestamp: Date.now()
          }]
        })),
        removeNotification: (id) => set((state) => ({
          notifications: state.notifications.filter(n => n.id !== id)
        }))
      }),
      {
        name: 'app-storage',
        partialize: (state) => ({ 
          theme: state.theme,
          language: state.language,
          sidebarCollapsed: state.sidebarCollapsed
        })
      }
    )
  )
)
```

### 2. Chart Store (with Caching)

```typescript
// src/stores/useChartStore.ts
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface CachedData {
  candles: Candle[]
  timestamp: number
  symbol: string
  timeframe: string
}

interface ViewState {
  timeframe: string
  from: number
  to: number
  barSpacing: number
}

interface ChartState {
  // Data cache (not persisted)
  candleCache: Map<string, CachedData>
  
  // View states (persisted)
  viewStates: Map<string, ViewState>
  
  // Current state
  activeSymbol: string
  activeTimeframe: string
  isLoading: boolean
  
  // Actions
  setActiveSymbol: (symbol: string) => void
  setActiveTimeframe: (timeframe: string) => void
  cacheCandles: (key: string, data: Candle[], ttl?: number) => void
  getCachedCandles: (key: string) => Candle[] | null
  invalidateCache: (pattern?: string) => void
  saveViewState: (symbol: string, state: ViewState) => void
  getViewState: (symbol: string) => ViewState | null
  setLoading: (loading: boolean) => void
}

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes default

export const useChartStore = create<ChartState>()(
  devtools(
    (set, get) => ({
      // State
      candleCache: new Map(),
      viewStates: new Map(),
      activeSymbol: 'EURUSD',
      activeTimeframe: '1h',
      isLoading: false,
      
      // Actions
      setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),
      setActiveTimeframe: (timeframe) => set({ activeTimeframe: timeframe }),
      
      cacheCandles: (key, data, ttl = CACHE_TTL) => {
        const cache = get().candleCache
        cache.set(key, {
          candles: data,
          timestamp: Date.now() + ttl,
          symbol: key.split('-')[0],
          timeframe: key.split('-')[1]
        })
        set({ candleCache: new Map(cache) })
      },
      
      getCachedCandles: (key) => {
        const cached = get().candleCache.get(key)
        if (!cached) return null
        
        // Check if expired
        if (Date.now() > cached.timestamp) {
          get().candleCache.delete(key)
          set({ candleCache: new Map(get().candleCache) })
          return null
        }
        
        return cached.candles
      },
      
      invalidateCache: (pattern) => {
        const cache = get().candleCache
        if (!pattern) {
          cache.clear()
        } else {
          Array.from(cache.keys())
            .filter(key => key.includes(pattern))
            .forEach(key => cache.delete(key))
        }
        set({ candleCache: new Map(cache) })
      },
      
      saveViewState: (symbol, state) => {
        const viewStates = get().viewStates
        viewStates.set(symbol, state)
        set({ viewStates: new Map(viewStates) })
      },
      
      getViewState: (symbol) => {
        return get().viewStates.get(symbol) || null
      },
      
      setLoading: (loading) => set({ isLoading: loading })
    }),
    {
      name: 'chart-store'
    }
  )
)
```

### 3. Trading Store

```typescript
// src/stores/useTradingStore.ts
import { create } from 'zustand'
import { devtools, subscribeWithSelector } from 'zustand/middleware'

interface Position {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  size: number
  entryPrice: number
  currentPrice: number
  pnl: number
  timestamp: number
}

interface Order {
  id: string
  symbol: string
  type: 'market' | 'limit' | 'stop'
  side: 'buy' | 'sell'
  size: number
  price?: number
  status: 'pending' | 'filled' | 'cancelled'
}

interface TradingState {
  // Market data
  symbols: string[]
  selectedSymbol: string
  
  // Positions & Orders
  positions: Position[]
  orders: Order[]
  
  // Account
  balance: number
  equity: number
  margin: number
  
  // Actions
  setSelectedSymbol: (symbol: string) => void
  updatePosition: (position: Position) => void
  closePosition: (id: string) => void
  placeOrder: (order: Omit<Order, 'id'>) => void
  cancelOrder: (id: string) => void
  updateAccountInfo: (info: Partial<TradingState>) => void
}

export const useTradingStore = create<TradingState>()(
  subscribeWithSelector(
    devtools(
      (set, get) => ({
        // State
        symbols: ['EURUSD', 'USDJPY', 'GBPUSD'],
        selectedSymbol: 'EURUSD',
        positions: [],
        orders: [],
        balance: 100000,
        equity: 100000,
        margin: 0,
        
        // Actions
        setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
        
        updatePosition: (position) => set((state) => ({
          positions: state.positions.map(p => 
            p.id === position.id ? position : p
          )
        })),
        
        closePosition: (id) => set((state) => ({
          positions: state.positions.filter(p => p.id !== id)
        })),
        
        placeOrder: (order) => set((state) => ({
          orders: [...state.orders, { ...order, id: crypto.randomUUID() }]
        })),
        
        cancelOrder: (id) => set((state) => ({
          orders: state.orders.filter(o => o.id !== id)
        })),
        
        updateAccountInfo: (info) => set(info)
      }),
      {
        name: 'trading-store'
      }
    )
  )
)
```

## Integration Patterns

### 1. With React Components

```typescript
// Basic usage
function TradingComponent() {
  const symbol = useTradingStore(state => state.selectedSymbol)
  const setSymbol = useTradingStore(state => state.setSelectedSymbol)
  
  return <PairSelector value={symbol} onChange={setSymbol} />
}

// Multiple selectors (optimized)
function ChartComponent() {
  const { candles, isLoading } = useChartStore(state => ({
    candles: state.getCachedCandles('EURUSD-1h'),
    isLoading: state.isLoading
  }))
  
  // Component only re-renders when these specific values change
}

// Using actions outside components
export async function fetchAndCacheCandles(symbol: string, timeframe: string) {
  const key = `${symbol}-${timeframe}`
  
  // Check cache first
  const cached = useChartStore.getState().getCachedCandles(key)
  if (cached) return cached
  
  // Fetch from API
  const candles = await invoke('fetch_candles', { symbol, timeframe })
  
  // Cache the result
  useChartStore.getState().cacheCandles(key, candles)
  
  return candles
}
```

### 2. With Tauri Backend

```typescript
// Listen to Tauri events and update store
import { listen } from '@tauri-apps/api/event'

// In your app initialization
listen('market-update', (event) => {
  const { symbol, price } = event.payload
  useTradingStore.getState().updatePosition({
    symbol,
    currentPrice: price
  })
})

// Sync with backend cache
async function loadChartData(symbol: string, timeframe: string) {
  const store = useChartStore.getState()
  const key = `${symbol}-${timeframe}`
  
  // Check frontend cache first
  const cached = store.getCachedCandles(key)
  if (cached) return cached
  
  store.setLoading(true)
  try {
    // Backend will check its own cache
    const data = await invoke('fetch_candles', { symbol, timeframe })
    store.cacheCandles(key, data)
    return data
  } finally {
    store.setLoading(false)
  }
}
```

### 3. Middleware & Subscriptions

```typescript
// Log all state changes
const unsubscribe = useAppStore.subscribe(
  (state) => console.log('State changed:', state)
)

// Subscribe to specific changes
const unsubscribeSymbol = useTradingStore.subscribe(
  (state) => state.selectedSymbol,
  (symbol) => {
    console.log('Symbol changed to:', symbol)
    // Trigger side effects
  }
)

// Custom middleware
const loggerMiddleware = (config) => (set, get, api) =>
  config(
    (...args) => {
      console.log('Before state change:', get())
      set(...args)
      console.log('After state change:', get())
    },
    get,
    api
  )
```

## Migration Strategy

### Phase 1: Setup (Week 1)
1. Install Zustand: `npm install zustand`
2. Create store structure
3. Implement `useChartStore` with caching
4. Test with a single component

### Phase 2: Gradual Migration (Week 2-3)
1. Keep existing Context providers
2. Move chart caching to Zustand
3. Components can use both:
   ```typescript
   function HybridComponent() {
     // From Context
     const { selectedPair } = useTrading()
     
     // From Zustand
     const cachedData = useChartStore(state => state.getCachedCandles(selectedPair))
   }
   ```

### Phase 3: Full Migration (Week 4)
1. Move all TradingContext state to useTradingStore
2. Move BuildContext state to useBuildStore
3. Remove Context providers
4. Update all components to use Zustand

### Phase 4: Optimization (Ongoing)
1. Add persistence where needed
2. Implement subscriptions for real-time updates
3. Add development tools
4. Performance profiling

## Best Practices

### 1. Store Design
- Keep stores focused (single responsibility)
- Separate actions from state
- Use TypeScript for all stores
- Document complex state shapes

### 2. Performance
- Use selectors to minimize re-renders
- Don't store derived state
- Clear cache periodically
- Use shallow equality for objects

### 3. Testing
```typescript
// Easy to test stores
import { renderHook, act } from '@testing-library/react'

test('should cache candles', () => {
  const { result } = renderHook(() => useChartStore())
  
  act(() => {
    result.current.cacheCandles('EURUSD-1h', mockCandles)
  })
  
  expect(result.current.getCachedCandles('EURUSD-1h')).toEqual(mockCandles)
})
```

### 4. DevTools
```typescript
// Enable Redux DevTools
if (process.env.NODE_ENV === 'development') {
  import('zustand/middleware').then(({ devtools }) => {
    // Add devtools to your stores
  })
}
```

## Common Patterns

### Auto-save Draft
```typescript
const useDraftStore = create(
  persist(
    (set) => ({
      draft: {},
      updateDraft: (draft) => set({ draft })
    }),
    {
      name: 'draft-storage',
      getStorage: () => sessionStorage
    }
  )
)
```

### Computed Values
```typescript
const useComputedStore = create((set, get) => ({
  items: [],
  filter: '',
  
  // Computed
  get filteredItems() {
    const { items, filter } = get()
    return items.filter(item => item.name.includes(filter))
  }
}))
```

### Async Actions
```typescript
const useAsyncStore = create((set, get) => ({
  data: null,
  loading: false,
  error: null,
  
  fetchData: async () => {
    set({ loading: true, error: null })
    try {
      const data = await api.getData()
      set({ data, loading: false })
    } catch (error) {
      set({ error: error.message, loading: false })
    }
  }
}))
```

## Conclusion

This Zustand architecture provides:
- ✅ Scalable state management
- ✅ TypeScript safety
- ✅ Performance optimization
- ✅ Easy testing
- ✅ Gradual migration path
- ✅ Integration with existing Tauri backend

Start with the `useChartStore` for immediate benefits (caching), then gradually adopt other stores as needed.