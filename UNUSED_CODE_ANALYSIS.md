# Unused Code Analysis Report

## Summary
This report documents unused imports and functions found in the SPtraderB codebase, focusing on Tauri `listen` imports and cache/view state functions.

## Unused Tauri `listen` Imports

### Files with unused `listen` imports:
1. **`src/components/BitcoinMarketDataBar.tsx`**
   - Imports `listen` on line 4 but never uses it
   - Component fetches data via polling with `setInterval` instead of real-time events

2. **`src/components/MonacoIDE.tsx`**
   - Imports `listen` on line 42 but never uses it
   - May have been intended for real-time file system monitoring

3. **`src/components/BitcoinTestChart.tsx`**
   - Imports `listen` on line 15 but never uses it
   - Has comments about "Real-time streaming" but uses polling instead

4. **`src/components/MarketDataChart.tsx`**
   - Imports `listen` on line 15 but never uses it
   - Similar to BitcoinTestChart, has streaming state but uses polling

### Files that DO use `listen`:
- `src/pages/OrchestratorPage.tsx` - Listens for 'log' and 'component-output' events
- `src/pages/DataIngestionPage.tsx` - Extensive use for ingestion events (5 different listeners)
- `src/components/orchestrator/backtest/BacktestRunner.tsx` - Listens for 'backtest_started'
- `src/components/AssetManager.tsx` - Listens for 'asset-added' and 'ingestion-progress'

## Unused Cache and View State Functions

### Functions imported but never called:

1. **`saveViewState` and `getViewState`**
   - Imported in: AdaptiveChart.tsx, BitcoinTestChart.tsx, MarketDataChart.tsx
   - Never actually called in any component
   - Defined in `useChartStore.ts` for saving/restoring chart view states
   - Likely intended for persisting zoom levels and scroll positions

2. **Functions that ARE used:**
   - `getCachedCandles` - Used in MonacoIDE.tsx and EnhancedDataSourceSelector.tsx
   - `setCachedCandles` - Used in EnhancedDataSourceSelector.tsx
   - `setCurrentSymbol` - Used in AdaptiveChart.tsx
   - `getCachedMetadata` and `setCachedMetadata` - Used in AdaptiveChart.tsx

## Analysis

### Unused `listen` imports appear to be:
1. **Incomplete features** - Components have infrastructure for real-time updates (StreamStatus state, etc.) but use polling instead
2. **Legacy code** - May have been copied from other components that do use real-time events
3. **Future placeholders** - Comments suggest intent to add real-time WebSocket/streaming

### Unused view state functions appear to be:
1. **Incomplete feature** - Infrastructure exists to save/restore chart states but was never implemented
2. **Not critical** - Charts work fine without persisting view states between sessions

## Recommendations

### For unused `listen` imports:
1. **Remove from components that clearly won't use them:**
   - BitcoinMarketDataBar.tsx (uses polling, unlikely to change)
   - MonacoIDE.tsx (no clear use case for events)

2. **Keep in chart components if real-time features are planned:**
   - BitcoinTestChart.tsx
   - MarketDataChart.tsx
   - These have StreamStatus state suggesting future real-time implementation

### For unused view state functions:
1. **Consider removing `saveViewState` and `getViewState`** from:
   - The store interface
   - All importing components
   - These have never been implemented and charts work without them

2. **Keep the cache functions that ARE used:**
   - `getCachedCandles`, `setCachedCandles` - Used for performance
   - `getCachedMetadata`, `setCachedMetadata` - Used for date ranges
   - `setCurrentSymbol` - Used for state management

## Code Locations

### To remove unused `listen` imports:
```typescript
// Remove this line from:
// - src/components/BitcoinMarketDataBar.tsx (line 4)
// - src/components/MonacoIDE.tsx (line 42)
import { listen } from '@tauri-apps/api/event';
```

### To remove unused view state functions:
```typescript
// Remove from destructuring in:
// - src/components/AdaptiveChart.tsx (lines 54-55)
// - src/components/BitcoinTestChart.tsx (lines 95-96)
// - src/components/MarketDataChart.tsx (lines 95-96)
saveViewState,
getViewState,

// Also remove from:
// - src/stores/useChartStore.ts (interface and implementation)
```

## Conclusion

These unused imports and functions represent either:
1. **Incomplete features** that were planned but not implemented
2. **Legacy code** from copying/refactoring
3. **Future placeholders** for planned enhancements

None appear to be critical - the application functions correctly without them. Removing the clearly unused code would improve maintainability without affecting functionality.