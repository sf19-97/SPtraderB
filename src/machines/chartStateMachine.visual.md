# Chart State Machine Visualization

## State Diagram

```
┌─────────┐
│  idle   │
└────┬────┘
     │ INITIALIZE
     ▼
┌─────────┐     DATA_ERROR    ┌─────────┐
│ loading ├───────────────────►│  error  │
└────┬────┘                    └─────────┘
     │ DATA_LOADED                   ▲
     ▼                               │
┌─────────────────────────────────────┐
│             ready                   │
│ ┌─────────────────┐ ┌─────────────┐ │
│ │   monitoring    │ │    zoom     │ │
│ │ ┌───────────┐  │ │ ┌─────────┐ │ │
│ │ │  active   │  │ │ │ normal  │ │ │
│ │ └─────┬─────┘  │ │ └────┬────┘ │ │
│ │       │        │ │      │      │ │
│ │  bar  │        │ │ SHIFT│      │ │
│ │spacing│        │ │      ▼      │ │
│ │       ▼        │ │ ┌─────────┐ │ │
│ │ ┌───────────┐  │ │ │ locked  │ │ │
│ │ │ checking  │  │ │ └─────────┘ │ │
│ │ │timeframe  │  │ └─────────────┘ │
│ │ └─────┬─────┘  │                 │
│ │       │        │                 │
│ │  auto │        │                 │
│ │ switch│        │                 │
│ └───────┼────────┘                 │
│         │                          │
└─────────┼──────────────────────────┘
          │
          ▼
    ┌──────────────┐
    │ transitioning │
    └──────┬───────┘
           │ after 250ms
           ▼
      (back to loading)
```

## Key Features

### 1. Automatic Timeframe Switching
The state machine monitors bar spacing and automatically switches timeframes:

- **5m ↔ 15m**: Switch at 35/7 bar spacing
- **15m ↔ 1h**: Switch at 32/8 bar spacing  
- **1h ↔ 4h**: Switch at 32/8 bar spacing
- **4h ↔ 12h**: Switch at 24/4 bar spacing

### 2. Transition Cooldown
- 700ms cooldown prevents rapid switching
- Smooth fade animations (250ms)

### 3. Zoom State Management
- Normal mode: Standard zooming
- Locked mode: Shift key locks left edge during zoom

### 4. Error Handling
- Graceful error states
- Can reinitialize from error state

## Usage Example

```typescript
const {
  service,
  initialize,
  updateBarSpacing,
  notifyDataLoaded,
  notifyDataError,
} = useChartMachine();

// Subscribe to state changes
const [state] = useActor(service);

// Initialize chart
initialize('EURUSD', '1h');

// Update bar spacing (triggers auto timeframe switch)
updateBarSpacing(35); // Will switch 1h → 15m

// Handle data loading
try {
  const data = await fetchData();
  notifyDataLoaded();
} catch (error) {
  notifyDataError(error.message);
}

// React to state
console.log(state.value); // 'ready', 'loading', etc.
console.log(state.context.opacity); // For fade animations
```

## Benefits

1. **Predictable State**: All transitions are explicit
2. **Race Condition Prevention**: Guards and cooldowns
3. **Separation of Concerns**: State logic separate from UI
4. **Testability**: Can test state machine independently
5. **Debugging**: Use XState DevTools for visualization