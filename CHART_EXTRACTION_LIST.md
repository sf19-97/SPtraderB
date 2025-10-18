# Chart Library Extraction List

This document contains all the components, hooks, utilities, and dependencies needed to extract the chart functionality into a separate package.

## Core Components

### 1. Main Chart Component
- **File**: `src/components/MarketDataChart.tsx`
- **Description**: The main chart component with smooth transitions, auto-timeframe switching, and real-time updates
- **Dependencies**: All items listed below

### 2. Supporting Components
- **CountdownTimer**: `src/components/CountdownTimer.tsx`
  - Shows countdown to next candle boundary
  - Triggers placeholder candle creation

## Hooks

### 1. Chart Setup & Rendering
- **useChartSetup**: `src/hooks/useChartSetup.ts`
  - Creates and configures the lightweight-charts instance
  - Handles theme configuration
  - Manages chart lifecycle

### 2. Chart Zoom & Interaction
- **useChartZoom**: `src/hooks/useChartZoom.ts`
  - Monitors bar spacing changes
  - Handles shift-key left edge locking
  - Tracks visible range changes

### 3. Data Management
- **useChartData**: `src/hooks/useChartData.ts`
  - Fetches chart data through coordinator
  - Manages loading states
  - Handles cache invalidation

### 4. Placeholder Candles
- **usePlaceholderCandle**: `src/hooks/usePlaceholderCandle.ts`
  - Creates temporary candles at timeframe boundaries
  - Updates placeholders with real data when available
  - Helper function: `calculateCandleTime()`

### 5. Countdown Timer
- **useCountdownTimer**: `src/hooks/useCountdownTimer.ts`
  - Calculates time to next candle boundary
  - Provides countdown display and colors
  - Triggers boundary callbacks

### 6. Auto Timeframe Switching
- **useAutoTimeframeSwitch**: `src/hooks/useAutoTimeframeSwitch.ts`
  - Contains bar spacing thresholds
  - Helper: `getBarSpacingForTimeframeSwitch()`

### 7. Session Persistence (optional)
- **useChartSessionPersistence**: `src/hooks/useChartSessionPersistence.ts`
- **useInitialChartState**: `src/hooks/useInitialChartState.ts`

## Services

### 1. Data Coordination
- **ChartDataCoordinator**: `src/services/ChartDataCoordinator.ts`
  - Singleton service for data fetching
  - Request deduplication
  - Cache management with normalization
  - Default range calculation

## State Management

### 1. Chart Store
- **useChartStore**: `src/stores/useChartStore.ts`
  - Zustand store for chart state
  - Cache management
  - View state persistence
  - Metadata caching

### 2. State Machine (optional for v2)
- **chartStateMachine**: `src/machines/chartStateMachine.ts`
  - XState machine for complex state transitions
  - Currently used in refactored version but not in smooth version

## Utilities

### 1. Chart Helpers
- **chartHelpers**: `src/utils/chartHelpers.ts`
  - `calculateBarSpacingForTimeframeSwitch()`
  - `getDaysToShowForTimeframe()`
  - `setVisibleRangeByDays()`
  - `getVisibleRangeDuration()`
  - `isTimeVisible()`
  - `scrollToTime()`
  - `findLastRealCandle()`
  - `createPlaceholderCandle()`
  - `getTimeframePeriodSeconds()`
  - `formatCountdown()`
  - `getCountdownColor()`

## External Dependencies

### NPM Packages
```json
{
  "lightweight-charts": "^4.x.x",
  "zustand": "^4.x.x",
  "zustand/middleware": "for devtools",
  "@mantine/core": "for UI components (Box, Text)",
  "react": "^18.x.x"
}
```

### Platform-Specific (Tauri)
- `@tauri-apps/api/core` - for `invoke()` (backend communication)
- `@tauri-apps/api/event` - for `listen()` (real-time events)

**Note**: These would need to be abstracted or replaced for web-only usage

## Types & Interfaces

### Core Types
```typescript
interface ChartData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SymbolMetadata {
  data_from: number;
  data_to: number;
  total_ticks?: number;
}

interface StreamStatus {
  connected: boolean;
  message: string;
}
```

## Key Features to Preserve

1. **Smooth Transitions**
   - Opacity fade (0.2 → 1.0) during timeframe switches
   - Direct data fetching (not through state machine)
   - Visible range preservation
   - Bar spacing calculations

2. **Auto Timeframe Switching**
   - Based on bar spacing thresholds
   - Cooldown mechanism (700ms)
   - Maintains view context

3. **Real-time Updates**
   - Placeholder candles at boundaries
   - Periodic refresh (30s intervals)
   - Stream status monitoring

4. **View Preservation**
   - Shift-key left edge locking
   - Visible range restoration after switches
   - Smart bar spacing adjustments

## Extraction Strategy

1. **Create Package Structure**
   ```
   chart-lib/
   ├── src/
   │   ├── components/
   │   ├── hooks/
   │   ├── services/
   │   ├── stores/
   │   ├── utils/
   │   └── types/
   ├── package.json
   └── tsconfig.json
   ```

2. **Abstract Platform Dependencies**
   - Create interfaces for data fetching
   - Make Tauri invoke/listen optional
   - Support both REST and WebSocket data sources

3. **Make Configurable**
   - Theme configuration
   - Timeframe options
   - Bar spacing thresholds
   - Cache TTL settings

4. **Export Clean API**
   ```typescript
   export { MarketDataChart } from './components/MarketDataChart';
   export { ChartDataCoordinator } from './services/ChartDataCoordinator';
   export { useChartStore } from './stores/useChartStore';
   export * from './types';
   ```