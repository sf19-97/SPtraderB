# Complete MarketDataChart & MarketChartPage File System Reference

## Project Root: `/Users/sebastian/Projects/SPtraderB/`

## Full Directory Tree with File Paths

```
/Users/sebastian/Projects/SPtraderB/
├── src/
│   ├── components/
│   │   ├── MarketDataChart.tsx (846 lines)
│   │   ├── MarketDataChart.old.tsx (backup)
│   │   ├── MarketDataBar.tsx (99 lines)
│   │   ├── ResolutionTracker.tsx (116 lines)
│   │   ├── PairSelector.tsx
│   │   ├── CountdownTimer.tsx (160 lines)
│   │   ├── ErrorBoundary.tsx (45 lines)
│   │   └── examples/
│   │       ├── SimpleChart.tsx
│   │       └── ZoomableChart.tsx
│   │
│   ├── pages/
│   │   └── MarketChartPage.tsx (36 lines)
│   │
│   ├── hooks/
│   │   ├── useChartData.ts (119 lines)
│   │   ├── useChartSetup.ts (222 lines)
│   │   ├── useChartZoom.ts (195 lines)
│   │   ├── usePlaceholderCandle.ts (174 lines)
│   │   ├── useCountdownTimer.ts
│   │   └── useAutoTimeframeSwitch.ts
│   │
│   ├── machines/
│   │   ├── chartStateMachine.ts (380 lines)
│   │   └── chartStateMachine.example.tsx
│   │
│   ├── services/
│   │   └── ChartDataCoordinator.ts (320 lines)
│   │
│   ├── stores/
│   │   ├── useChartStore.ts (249 lines)
│   │   └── useTradingStore.ts (120+ lines)
│   │
│   └── utils/
│       ├── chartHelpers.ts (191 lines)
│       ├── consoleInterceptor.ts
│       └── errorCollector.ts
│
├── src-tauri/
│   └── src/
│       ├── commands/
│       │   └── bitcoin_data.rs (has get_market_candles equivalent)
│       ├── candles/
│       │   ├── mod.rs
│       │   ├── commands.rs (get_market_candles implementation)
│       │   └── cache.rs
│       └── main.rs (Tauri command registration)
│
├── .vscode/
│   └── settings.json (rust-analyzer config)
│
├── config files
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── eslint.config.js
│   └── package.json
│
└── documentation
    ├── CLAUDE.md (project instructions)
    └── data-ingestion/
        └── BITCOIN_CASCADE_PATTERN.md (critical pattern doc)
```

## Import Dependency Graph

```
MarketChartPage.tsx
├── imports from:
│   ├── ../components/MarketDataBar.tsx
│   ├── ../components/MarketDataChart.tsx
│   ├── ../components/ErrorBoundary.tsx
│   └── ../stores/useTradingStore.ts
│
└── MarketDataChart.tsx (core component - 846 lines)
    ├── imports from:
    │   ├── ../stores/useChartStore.ts
    │   ├── ../hooks/useChartData.ts
    │   ├── ../hooks/useChartSetup.ts
    │   ├── ../hooks/useChartZoom.ts
    │   ├── ../hooks/usePlaceholderCandle.ts
    │   ├── ../hooks/useAutoTimeframeSwitch.ts
    │   ├── ../machines/chartStateMachine.ts
    │   ├── ../utils/chartHelpers.ts
    │   ├── ./CountdownTimer.tsx
    │   ├── @tauri-apps/api/core
    │   ├── @tauri-apps/api/event
    │   ├── @xstate/react
    │   ├── lightweight-charts
    │   └── @mantine/core
    │
    └── useChartData.ts
        └── imports from:
            └── ../services/ChartDataCoordinator.ts
                └── imports from:
                    └── @tauri-apps/api/core (invoke)
```

## Backend Files (Rust/Tauri)

```
/Users/sebastian/Projects/SPtraderB/src-tauri/src/
├── main.rs (1286+ lines)
│   └── registers command: candles::commands::get_market_candles
│
├── candles/
│   ├── mod.rs (defines MarketCandle struct)
│   ├── commands.rs (get_market_candles implementation)
│   └── cache.rs (CandleCache implementation)
│
└── candle_monitor.rs (real-time monitoring)
```

## Key File Relationships

### 1. Data Flow Path:
```
MarketChartPage.tsx
→ MarketDataChart.tsx
→ useChartData.ts
→ ChartDataCoordinator.ts
→ invoke('get_market_candles')
→ src-tauri/src/candles/commands.rs
→ PostgreSQL
```

### 2. State Management Path:
```
MarketDataChart.tsx
→ useChartMachine() → chartStateMachine.ts
→ useChartStore() → useChartStore.ts
→ useTradingStore() → useTradingStore.ts
```

### 3. UI Component Hierarchy:
```
MarketChartPage.tsx
├── MarketDataBar.tsx
│   ├── PairSelector.tsx
│   └── ResolutionTracker.tsx
└── ErrorBoundary.tsx
    └── MarketDataChart.tsx
        └── CountdownTimer.tsx
```

## File Statistics

| File Path | Lines | Imports | Exported |
|-----------|-------|---------|----------|
| `/src/components/MarketDataChart.tsx` | 846 | 15 | 1 default |
| `/src/machines/chartStateMachine.ts` | 380 | 3 | 3 (machine, hook, types) |
| `/src/services/ChartDataCoordinator.ts` | 320 | 2 | 1 class instance |
| `/src/stores/useChartStore.ts` | 249 | 2 | 1 hook |
| `/src/hooks/useChartSetup.ts` | 222 | 2 | 1 hook |
| `/src/hooks/useChartZoom.ts` | 195 | 2 | 1 hook |
| `/src/utils/chartHelpers.ts` | 191 | 1 | 10 functions |
| `/src/hooks/usePlaceholderCandle.ts` | 174 | 2 | 1 hook |
| `/src/components/CountdownTimer.tsx` | 160 | 4 | 2 components |
| `/src/hooks/useChartData.ts` | 119 | 2 | 1 hook |
| `/src/components/ResolutionTracker.tsx` | 116 | 3 | 1 component |
| `/src/components/MarketDataBar.tsx` | 99 | 5 | 1 default |
| `/src/components/ErrorBoundary.tsx` | 45 | 1 | 1 default |
| `/src/pages/MarketChartPage.tsx` | 36 | 4 | 1 default |

## Key Components Reference

### MarketDataChart.tsx (`/src/components/MarketDataChart.tsx`)
- Main chart component integrating all hooks and state machine
- Props: `symbol?`, `timeframe?`, `onTimeframeChange?`, `isFullscreen?`, `onToggleFullscreen?`
- Key hooks used: `useChartMachine`, `useChartSetup`, `useChartData`, `useChartZoom`, `usePlaceholderCandle`

### chartStateMachine.ts (`/src/machines/chartStateMachine.ts`)
- XState v5 state machine managing chart lifecycle
- States: idle, loading, ready (with monitoring substates), transitioning, error
- Handles automatic timeframe switching based on bar spacing
- Exports: `chartMachine`, `useChartMachine` hook, TypeScript types

### ChartDataCoordinator.ts (`/src/services/ChartDataCoordinator.ts`)
- Centralized data fetching with request deduplication
- Cache key normalization matching backend logic
- Default range management per symbol-timeframe
- Singleton instance exported as `chartDataCoordinator`

### useChartData.ts (`/src/hooks/useChartData.ts`)
- Hook managing data fetching through ChartDataCoordinator
- Provides loading states, error handling, and data refresh
- Options: `autoLoad?`, `range?`

### useChartSetup.ts (`/src/hooks/useChartSetup.ts`)
- Chart initialization with TradingView Lightweight Charts
- Theme support, responsive sizing
- Returns: `chart`, `series`, `isReady`

### useChartZoom.ts (`/src/hooks/useChartZoom.ts`)
- Zoom functionality with shift key handling
- Bar spacing monitoring with customizable interval
- Callbacks: `onBarSpacingChange`, `onVisibleRangeChange`

### Backend get_market_candles (`/src-tauri/src/candles/commands.rs`)
- Tauri command for fetching market candles
- Timestamp normalization for cache efficiency
- Returns: `MarketChartResponse` with data and metadata

This reference provides a complete overview of all files and components involved in the MarketDataChart and MarketChartPage implementation.