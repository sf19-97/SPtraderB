# Plan: Professional Instant Chart Loading

## Goal
Make charts load instantly on app startup with cached data from the last session, similar to professional trading platforms like Bloomberg Terminal and TradingView.

## Phase 1: Backend Session Persistence

### 1. Create Session State Structure (`src-tauri/src/session.rs`)
```rust
pub struct ChartSession {
    symbol: String,
    timeframe: String,
    last_candles: Vec<MarketCandle>,  // Last 500-1000 candles
    visible_range: (i64, i64),
    bar_spacing: f64,
    saved_at: DateTime<Utc>,
}
```

### 2. Save Session on Every Chart Change
- New command: `save_chart_session`
- Triggered when: symbol changes, timeframe changes, or on periodic interval
- Saves to: `~/.config/sptraderb/last_session.json`

### 3. Load Session on Startup
- In `main.rs` setup phase
- Load before window creation
- Make available as managed state

## Phase 2: Tauri Integration

### 4. Modify `main.rs`
```rust
.setup(|app| {
    // Load session BEFORE window opens
    let session = session::load_last_session(&pool).await?;
    app.manage(InitialState { 
        chart_session: session,
        metadata_cache: preloaded_metadata,
    });
    Ok(())
})
```

### 5. New Commands
- `get_initial_state` - Returns preloaded session
- `save_chart_state` - Persists current view

## Phase 3: Frontend Integration

### 6. Update App.tsx
```typescript
// Before MatrixLogin even shows
useEffect(() => {
  invoke('get_initial_state').then(state => {
    // Store in context/zustand
    setInitialChartData(state);
  });
}, []);
```

### 7. MarketDataChart Enhancement
```typescript
// Use initial state if available
const { initialData } = useChartStore();
const [chartData, setChartData] = useState(initialData || []);
```

## Phase 4: Optimizations

### 8. Smart Caching Strategy
- Save only visible range + buffer
- Compress candle data (store as binary)
- Update in background without blocking UI

### 9. Progressive Enhancement
- Show cached data immediately
- Display "updating..." indicator
- Merge fresh data seamlessly

## Phase 5: Fallback & Recovery

### 10. Multiple Cache Layers
- Rust: Primary cache (filesystem)
- IndexedDB: Browser fallback  
- Memory: Runtime cache

## Benefits
- **0ms to first candle** - Cached data shows instantly
- **Professional UX** - Like Bloomberg/TradingView
- **Works offline** - Shows last session
- **Survives crashes** - Persistent state

## Implementation Order
1. Backend commands first (Rust)
2. Frontend state management
3. Wire up save triggers
4. Test cold start performance
5. Add compression/optimization

## Success Metrics
- Time to first candle: < 50ms
- Time to interactive chart: < 200ms
- Cache hit rate: > 95%
- Session restore success: > 99%

## Technical Details

### Session File Format
```json
{
  "version": 1,
  "symbol": "EURUSD",
  "timeframe": "1h",
  "candles": [...],
  "visible_range": {
    "from": 1704067200,
    "to": 1704153600
  },
  "bar_spacing": 12,
  "saved_at": "2024-01-01T12:00:00Z"
}
```

### Cache Invalidation
- On app version change
- After 24 hours
- On data corruption
- Manual clear option

### Error Handling
- Corrupted cache: Fall back to fresh fetch
- Missing cache: Normal startup
- Partial cache: Use what's available

This plan transforms the app from "loading on startup" to "instant professional trading terminal".