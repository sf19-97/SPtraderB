# SPtraderB Project Context

## Project Overview
SPtraderB is a desktop trading application built with Tauri v2 that implements a fractal candlestick charting system. The application automatically adjusts chart timeframes based on zoom levels, providing a seamless multi-resolution viewing experience for forex trading data.

## Technology Stack
- **Frontend**: React + TypeScript with TradingView Lightweight Charts v5
- **Backend**: Rust + Tauri v2
- **Database**: PostgreSQL 17 with TimescaleDB extension
- **Data Source**: Dukascopy historical forex tick data
- **Data Ingestion**: Python script for downloading and processing tick data

## Key Features
1. **Fractal Zoom System**: Automatically switches between timeframes (5m, 15m, 1h, 4h, 12h) based on candle width
2. **Matrix-themed Login**: Falling green characters with "redpill" password access
3. **State Machine**: Prevents race conditions during timeframe transitions
4. **Performance Optimized**: Smart data loading with TimescaleDB continuous aggregates

## Project Structure
- `/src/` - React/TypeScript frontend code
  - `App.tsx` - Main trading interface
  - `components/AdaptiveChart.tsx` - Fractal chart component
  - `components/MatrixLogin.tsx` - Matrix-themed login screen
- `/src-tauri/` - Rust/Tauri backend code
  - Database queries and data serving
- `/data-ingestion/` - Python scripts for data ingestion
  - `dukascopy_ingester.py` - Downloads forex tick data

## Development Commands
```bash
# Start development server
npm run dev

# Run Tauri in development mode
npm run tauri dev

# Build for production
npm run tauri build

# Lint and type checking (if available)
npm run lint
npm run typecheck
```

## Database Setup
The project requires PostgreSQL 17 with TimescaleDB extension. The database contains:
- Tick data table
- Continuous aggregates for 5m, 15m, 1h, 4h, 12h timeframes
- Currently loaded with 5 months of EURUSD data (Jan 2 - May 31, 2024)

## Important Notes
- The Matrix login uses "redpill" as the password
- The fractal zoom switches timeframes when:
  - Candle width < 5 pixels: Switch to higher timeframe (zoom out)
  - Candle width > 30 pixels: Switch to lower timeframe (zoom in)
- State machine prevents concurrent transitions to avoid oscillation

## Known Issues
- Limited panning capabilities
- Some oscillation between timeframes during aggressive zooming
- Performance issues with 5m timeframe on large datasets

## Current Refactor Plans
<!-- PASTE YOUR REFACTOR PLANS BELOW THIS LINE -->

# SPTraderB Refactor Plan - Auditor Approved
*Stop overthinking. Fix the real problems.*

## Phase 0: Emergency Math Fix (DO THIS TODAY)

### The One Line That's Breaking Everything

```typescript
// Find this line in handleAdaptiveTimeframeSwitch:
const candleWidth = chartWidth / visibleBars;

// Replace with:
const visibleData = seriesRef.current?.data() || [];
const fromIndex = Math.max(0, Math.floor(visibleRange.from));
const toIndex = Math.min(visibleData.length - 1, Math.ceil(visibleRange.to));
const actualVisibleCandles = toIndex - fromIndex + 1;
const candleWidth = chartWidth / actualVisibleCandles;
```

**That's it. Test this first. It might fix your zoom issues immediately.**

---

## Phase 1: Use The Library Properly (2 Hours)

### Stop Fighting Lightweight Charts

```typescript
// AdaptiveChart.tsx modifications
const getActualVisibleCandles = () => {
  if (!chartRef.current || !seriesRef.current) return 0;
  
  const timeScale = chartRef.current.timeScale();
  const visibleRange = timeScale.getVisibleLogicalRange();
  if (!visibleRange) return 0;
  
  // Use the library's method to get actual bar count
  const barsInfo = seriesRef.current.barsInLogicalRange(visibleRange);
  return barsInfo?.barsBefore || 0;
};

// Update your zoom handler
const handleAdaptiveTimeframeSwitch = async (visibleRange: any) => {
  if (chartState.isTransitioning) return;
  
  const actualCandles = getActualVisibleCandles();
  const candleWidth = chartContainerRef.current!.clientWidth / actualCandles;
  
  console.log(`[DEBUG] Actual visible candles: ${actualCandles}, width: ${candleWidth}px`);
  
  // Now your thresholds will work correctly
  if (candleWidth < MIN_CANDLE_WIDTH) {
    // Switch to higher timeframe
  } else if (candleWidth > MAX_CANDLE_WIDTH) {
    // Switch to lower timeframe
  }
};
```

---

## Phase 2: Smart Timeframe Switching (4 Hours)

### Make Transitions Preserve Visual Density

```typescript
interface TimeframeTransition {
  from: string;
  to: string;
  preserveVisualDensity: (currentCandles: number) => { 
    targetCandles: number;
    expandFactor: number;
  };
}

// When switching timeframes, maintain similar visual density
const transitionRules: Record<string, any> = {
  '15m->1h': (candles: number) => ({
    targetCandles: Math.round(candles / 4),
    expandFactor: 1.0  // Same time range shows 1/4 candles
  }),
  '1h->15m': (candles: number) => ({
    targetCandles: candles * 4,
    expandFactor: 1.0  // Same range shows 4x candles
  }),
  '1h->4h': (candles: number) => ({
    targetCandles: Math.max(50, Math.round(candles / 4)),
    expandFactor: candles < 200 ? 4.0 : 1.0  // Expand range if too few
  }),
  // ... etc
};

const transitionToTimeframe = async (newTimeframe: string, visibleRange: any) => {
  const currentCandles = getActualVisibleCandles();
  const transitionKey = `${chartState.currentTimeframe}->${newTimeframe}`;
  const rule = transitionRules[transitionKey];
  
  if (!rule) {
    console.error(`No transition rule for ${transitionKey}`);
    return;
  }
  
  const { targetCandles, expandFactor } = rule(currentCandles);
  
  // Get current visible TIME range (not logical range)
  const timeRange = chartRef.current!.timeScale().getVisibleRange();
  const centerTime = (timeRange.from + timeRange.to) / 2;
  const currentSpan = timeRange.to - timeRange.from;
  const newSpan = currentSpan * expandFactor;
  
  // Load data for the new range
  const data = await loadChartData(newTimeframe, {
    from: centerTime - newSpan / 2,
    to: centerTime + newSpan / 2
  });
  
  // Critical: Set data WITHOUT fitting content
  seriesRef.current!.setData(data);
  
  // Restore the exact view (adjusted for expansion)
  chartRef.current!.timeScale().setVisibleRange({
    from: centerTime - newSpan / 2,
    to: centerTime + newSpan / 2
  });
};
```

---

## Phase 3: Rust Backend Intelligence (1 Day)

### Simple Endpoint That Actually Works

```rust
#[derive(Debug, Deserialize)]
struct ViewportRequest {
    symbol: String,
    center_time: i64,
    span_seconds: i64,
    target_candles: u32,  // Frontend suggests ideal count
}

#[derive(Debug, Serialize)]
struct AdaptiveData {
    candles: Vec<Candle>,
    actual_timeframe: String,
    metadata: ViewportMetadata,
}

#[derive(Debug, Serialize)]
struct ViewportMetadata {
    has_data_before: bool,
    has_data_after: bool,
    actual_candle_count: u32,
    suggested_next_timeframe: Option<String>,
}

#[tauri::command]
async fn fetch_adaptive_candles(
    request: ViewportRequest,
) -> Result<AdaptiveData, String> {
    // Determine best timeframe based on requested density
    let seconds_per_candle = request.span_seconds / request.target_candles as i64;
    
    let timeframe = match seconds_per_candle {
        0..=300 => "15m",      // < 5 min per candle, use 15m
        301..=1800 => "15m",   // 5-30 min per candle, use 15m
        1801..=7200 => "1h",   // 30-120 min per candle, use 1h
        7201..=21600 => "4h",  // 2-6 hours per candle, use 4h
        _ => "12h",            // > 6 hours per candle, use 12h
    };
    
    // Fetch with buffer for smooth panning
    let buffer = request.span_seconds / 4;
    let from = request.center_time - (request.span_seconds / 2) - buffer;
    let to = request.center_time + (request.span_seconds / 2) + buffer;
    
    let candles = fetch_candles(timeframe, from, to).await?;
    
    // Check if we should suggest different timeframe
    let actual_density = candles.len() as f64 / (request.span_seconds as f64 / 3600.0);
    let suggested_next = if actual_density > 200.0 {
        Some(get_higher_timeframe(timeframe))
    } else if actual_density < 20.0 {
        Some(get_lower_timeframe(timeframe))
    } else {
        None
    };
    
    Ok(AdaptiveData {
        candles: candles.into_iter()
            .filter(|c| c.time >= from && c.time <= to)
            .collect(),
        actual_timeframe: timeframe.to_string(),
        metadata: ViewportMetadata {
            has_data_before: check_data_exists(timeframe, from - 86400, from),
            has_data_after: check_data_exists(timeframe, to, to + 86400),
            actual_candle_count: candles.len() as u32,
            suggested_next_timeframe,
        },
    })
}
```

---

## Phase 4: Frontend Integration (4 Hours)

### Clean App.tsx Coordination

```typescript
// App.tsx
const [viewport, setViewport] = useState<Viewport | null>(null);
const [chartData, setChartData] = useState<AdaptiveData | null>(null);

// Throttled handler for viewport changes
const handleViewportChange = useMemo(
  () => throttle(async (newViewport: Viewport) => {
    // Only fetch if significant change
    if (!hasSignificantChange(viewport, newViewport)) return;
    
    const data = await invoke('fetch_adaptive_candles', {
      request: {
        symbol: selectedPair.replace('/', ''),
        center_time: (newViewport.from + newViewport.to) / 2,
        span_seconds: newViewport.to - newViewport.from,
        target_candles: 150,  // Ideal visual density
      }
    });
    
    setChartData(data);
    setViewport(newViewport);
    
    // Update UI to show current timeframe
    setCurrentResolution(data.actual_timeframe);
  }, 250),
  [selectedPair, viewport]
);

// Pass to chart
<AdaptiveChart
  data={chartData?.candles}
  onViewportChange={handleViewportChange}
  maintainView={true}  // Don't auto-fit
/>
```

---

## Phase 5: Polish (Optional)

Only after the above works:

1. **Add visual feedback**
   - Subtle fade during timeframe changes
   - Loading skeleton for new data
   - Current timeframe indicator

2. **Add manual override**
   - Lock button to prevent auto-switching
   - Force specific timeframe option

3. **Add performance monitoring**
   - FPS counter in debug mode
   - Network request counter
   - Render performance metrics

---

## Testing Strategy

### Phase 0 Test:
1. Click on 1h timeframe
2. Zoom in/out aggressively
3. **It should NOT oscillate anymore**

### Phase 1 Test:
1. Pan across a weekend
2. Candle width calculations should remain stable
3. No sudden jumps in zoom logic

### Phase 2 Test:
1. Zoom from 1h to 15m
2. Should see ~4x more candles in same time range
3. No position jumping

### Phase 3 Test:
1. Frontend requests 150 candles
2. Backend returns appropriate timeframe
3. Metadata indicates available pan ranges

### Phase 4 Test:
1. Complete user journey: zoom in → auto-switch → pan → zoom out
2. Should feel smooth like Google Maps

---

## Common Mistakes to Avoid

1. **Don't calculate time-based anything** - Count actual candles
2. **Don't fight Lightweight Charts** - Use its methods
3. **Don't over-engineer** - Fix the math first
4. **Don't trust logical ranges** - They include gaps
5. **Don't fitContent during transitions** - Preserve user's view

---

## Success Metrics

- [ ] No oscillation between timeframes
- [ ] Smooth transitions that preserve visual position
- [ ] Predictable behavior across weekends
- [ ] Less than 250ms transition time
- [ ] No cascading failures

**Start with Phase 0. One line of code might fix everything.**


<!-- END OF REFACTOR PLANS -->

## Next Steps

### Phase 0 Test:
1. Click on 1h timeframe
2. Zoom in/out aggressively
3. **It should NOT oscillate anymore**