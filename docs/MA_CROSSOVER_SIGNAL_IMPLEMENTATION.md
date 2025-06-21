# Moving Average Crossover Signal Implementation

## Overview
Implemented a complete moving average crossover signal with enhanced metadata (v2) and visual output capabilities.

## Files Created/Modified

### 1. Signal Implementation
**File**: `/workspace/core/signals/ma_crossover.py`
- Uses metadata version 2 with parameterized indicator requirements
- Detects golden cross (bullish) and death cross (bearish) signals
- Includes signal strength calculation based on MA separation
- Outputs visualization data in JSON format

### 2. Test Script
**File**: `/workspace/core/signals/test_ma_crossover.py`
- Comprehensive tests for crossover detection
- Tests confirmation bars and minimum separation features
- Outputs chart data for visualization

### 3. Strategy Example
**File**: `/workspace/strategies/ma_crossover_strategy.yaml`
- Shows how to use the signal in a complete strategy
- Demonstrates parameter overrides at strategy level
- Includes risk management and execution settings

### 4. UI Integration
**Modified**: `/src/components/MonacoIDE.tsx`
- Added chart data parsing from Python output
- Detects CHART_DATA_START/END markers
- Parses JSON and updates preview

**Modified**: `/src/components/PreviewChart.tsx`
- Extended to support signal visualization
- Draws vertical lines at crossover points
- Shows arrow indicators (↑ for golden cross, ↓ for death cross)
- Handles null values in indicators properly

### 5. Documentation
**File**: `/docs/ENHANCED_SIGNAL_METADATA_ARCHITECTURE.md`
- Complete documentation of the v2 metadata format
- Migration guide from v1 to v2
- Future enhancement ideas

## Testing Instructions

### 1. Run in IDE
1. Open Build Center
2. Navigate to Signals section
3. Click on "ma_crossover"
4. Click Run button
5. Watch for:
   - Terminal output showing crossover detections
   - Chart appearing in preview panel
   - Moving averages overlaid on price
   - Vertical lines at crossover points

### 2. Run Standalone Test
```bash
cd /Users/sebastian/Projects/SPtraderB/workspace
python -m core.signals.test_ma_crossover
```

### 3. Check Visualization
The chart should show:
- Candlestick price data
- Fast MA (blue line)
- Slow MA (orange line)
- Green vertical lines with ↑ for golden crosses
- Red vertical lines with ↓ for death crosses

## Key Features

### Enhanced Metadata (v2)
```python
'required_indicators': [
    {
        'name': 'ma_fast',
        'type': 'sma',
        'params': {'period': 20, 'source': 'close'}
    },
    {
        'name': 'ma_slow',
        'type': 'sma',
        'params': {'period': 50, 'source': 'close'}
    }
]
```

### Visualization Output
```python
print("CHART_DATA_START")
print(json.dumps({
    "time": [...],
    "open": [...],
    "high": [...],
    "low": [...],
    "close": [...],
    "indicators": {
        "ma_fast": [...],
        "ma_slow": [...]
    },
    "signals": {
        "crossovers": [49, 51, 82],
        "types": ["golden_cross", "death_cross", "golden_cross"]
    }
}))
print("CHART_DATA_END")
```

## Architecture Benefits

1. **No Rust Changes Required**: Works with current system
2. **Self-Documenting**: Metadata describes all requirements
3. **Flexible**: Strategies can override parameters
4. **Visual Feedback**: Immediate chart visualization
5. **Extensible**: Easy to add more signals using this pattern

## Next Steps

1. **Implement Rust Orchestrator**
   - Parse enhanced metadata
   - Instantiate indicators with parameters
   - Run and pass results to signals

2. **Add More Signals**
   - Bollinger Band squeeze
   - RSI divergence
   - MACD crossover
   - Volume breakout

3. **Enhance Visualization**
   - Show signal strength visually
   - Add performance metrics
   - Interactive tooltips on crossovers

## Known Limitations

1. **Manual Indicator Calculation**: Currently signals run their own test data
2. **JSON Size**: Large datasets may have performance impact
3. **Terminal Buffer**: Very long outputs might truncate

These will be addressed when the Rust orchestration layer is implemented.