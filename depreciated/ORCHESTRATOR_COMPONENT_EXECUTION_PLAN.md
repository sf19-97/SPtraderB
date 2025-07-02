# Orchestrator Component Execution Implementation Plan

**Date**: January 2025

## Overview

This document outlines the implementation plan for adding real component execution to the orchestrator's backtest functionality, replacing the current mock signal generation with actual Python indicator and signal execution.

## Current State

The orchestrator currently uses hardcoded mock signals:
```rust
// For testing, we'll create signals at specific candle indices
if candle_idx == 100 && position_tracker.positions.is_empty() {
    // Mock golden cross signal
```

This needs to be replaced with actual component execution that:
1. Runs Python indicators for each candle
2. Runs Python signals using indicator outputs
3. Evaluates signal outputs against strategy rules
4. Generates real trading decisions

## Implementation Plan

### Phase 1: Component Execution Infrastructure (Day 1)

#### 1.1 Add Component Runner to Orchestrator

```rust
// In orchestrator/mod.rs
impl Orchestrator {
    async fn run_component_for_candle(
        &self,
        component_type: &str,
        component_name: &str,
        candle_data: &[Candle],
        candle_index: usize,
        env_vars: HashMap<String, String>,
        window: &Window,
    ) -> Result<ComponentOutput, String> {
        // Run Python component with candle data
        // Parse stdout between markers
        // Return structured output
    }
}
```

#### 1.2 Define Component Output Structures

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ComponentOutput {
    stdout: String,
    stderr: String,
    execution_time: f64,
    indicator_values: Option<HashMap<String, f64>>,
    signal_data: Option<SignalData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SignalData {
    signal_type: String,
    strength: f64,
    metadata: HashMap<String, serde_json::Value>,
}
```

#### 1.3 Reuse Existing Workspace Module

The workspace module already has component execution:
```rust
// workspace.rs already has:
pub async fn run_component(path: &str, env_vars: HashMap<String, String>) -> Result<RunResult, String>
```

We need to:
1. Make it return stdout/stderr properly
2. Add candle data passing via environment variables
3. Parse component output

### Phase 2: Data Pipeline (Day 1-2)

#### 2.1 Candle Data Format for Components

Components need access to historical data up to the current candle:

```python
# In component environment
import os
import json

# Get candle data from environment
candle_data = json.loads(os.environ.get('CANDLE_DATA', '[]'))
current_index = int(os.environ.get('CURRENT_INDEX', '0'))

# Components see data up to current_index
historical_data = candle_data[:current_index + 1]
```

#### 2.2 Indicator Execution Flow

```rust
// For each candle in backtest:
for (candle_idx, candle) in candles.iter().enumerate() {
    // 1. Run indicators
    let mut indicator_outputs = HashMap::new();
    
    for indicator in &self.strategy_config.dependencies.indicators {
        let output = self.run_component_for_candle(
            "indicator",
            indicator,
            &candles[..=candle_idx], // Historical data up to current
            candle_idx,
            env_vars.clone(),
            window
        ).await?;
        
        indicator_outputs.insert(indicator.clone(), output);
    }
    
    // 2. Run signals with indicator outputs
    let mut signal_outputs = Vec::new();
    
    for signal in &self.strategy_config.dependencies.signals {
        let mut signal_env = env_vars.clone();
        // Add indicator outputs to environment
        signal_env.insert("INDICATOR_DATA".to_string(), 
            serde_json::to_string(&indicator_outputs)?);
        
        let output = self.run_component_for_candle(
            "signal",
            signal,
            &candles[..=candle_idx],
            candle_idx,
            signal_env,
            window
        ).await?;
        
        signal_outputs.push(output);
    }
}
```

### Phase 3: Signal Parsing and Evaluation (Day 2)

#### 3.1 Parse Signal Output

```rust
fn parse_signal_output(&self, output: &str, signal_name: &str) -> Vec<SignalEvent> {
    let mut signals = Vec::new();
    
    // Look for SIGNAL_START/SIGNAL_END markers
    if let Some(start) = output.find("SIGNAL_START") {
        if let Some(end) = output.find("SIGNAL_END") {
            let signal_json = &output[start + 12..end].trim();
            
            if let Ok(data) = serde_json::from_str::<Vec<serde_json::Value>>(signal_json) {
                for item in data {
                    if let Ok(signal) = self.parse_signal_event(item, signal_name) {
                        signals.push(signal);
                    }
                }
            }
        }
    }
    
    signals
}
```

#### 3.2 Strategy Rule Evaluation

Reuse existing evaluation logic but with real signals:
```rust
// Existing code in evaluate_entry_conditions can be reused
// Just need to pass real signals instead of mock
let should_enter = self.evaluate_entry_conditions(
    &real_signals,  // From component execution
    &position_tracker,
    window
);
```

### Phase 4: Integration and Testing (Day 2-3)

#### 4.1 Update Backtest Loop

Replace the mock signal generation with real execution:

```rust
// Remove this:
// if candle_idx == 100 && position_tracker.positions.is_empty() {
//     // Mock golden cross signal

// Add this:
let signals_at_candle = self.execute_components_for_candle(
    &candles,
    candle_idx,
    &mut component_cache,
    window
).await?;

for signal in signals_at_candle {
    all_signals.push(signal.clone());
    
    // Evaluate entry conditions
    if let Some(decision) = self.evaluate_signal_for_entry(
        &signal,
        &position_tracker,
        &portfolio,
        window
    ) {
        // Process order decision...
    }
}
```

#### 4.2 Performance Optimization

1. **Component Caching**: Cache indicator values that don't change
2. **Parallel Execution**: Run independent indicators in parallel
3. **Incremental Computation**: Only compute new values, not entire history

```rust
// Cache structure
struct ComponentCache {
    indicator_values: HashMap<String, Vec<f64>>,
    last_computed_index: HashMap<String, usize>,
}
```

### Phase 5: Environment Variable Protocol

#### 5.1 Standard Variables for All Components

```bash
# Data access
CANDLE_DATA='[{"time": 1234567890, "open": 1.0850, ...}, ...]'
CURRENT_INDEX='100'
SYMBOL='EURUSD'
TIMEFRAME='1h'

# For signals (additional)
INDICATOR_DATA='{"sma": {"values": [1.0851, 1.0852, ...]}, ...}'

# Component metadata
COMPONENT_TYPE='signal'
COMPONENT_NAME='ma_crossover'
```

#### 5.2 Component Output Protocol

Components must output in this format:
```python
# For indicators
print("INDICATOR_START")
print(json.dumps({
    "values": [1.0851, 1.0852, 1.0853],  # Last N values
    "current": 1.0853  # Current value
}))
print("INDICATOR_END")

# For signals
print("SIGNAL_START")
print(json.dumps([{
    "timestamp": "2024-01-01T00:00:00Z",
    "signal_type": "golden_cross",
    "strength": 0.85,
    "metadata": {...}
}]))
print("SIGNAL_END")
```

## Implementation Checklist

### Day 1
- [ ] Update RunResult in workspace.rs to capture stdout/stderr
- [ ] Create component execution method in orchestrator
- [ ] Define data structures for component outputs
- [ ] Implement candle data serialization

### Day 2
- [ ] Implement indicator execution loop
- [ ] Implement signal execution with indicator data
- [ ] Add signal parsing logic
- [ ] Integrate with existing strategy evaluation

### Day 3
- [ ] Remove mock signal generation
- [ ] Add comprehensive error handling
- [ ] Implement performance optimizations
- [ ] Test with real strategies

## Testing Strategy

### 1. Unit Tests
- Test component execution with mock Python scripts
- Test signal parsing with various output formats
- Test data serialization/deserialization

### 2. Integration Tests
- Test full backtest with simple SMA strategy
- Test with MA crossover strategy
- Test error handling with failing components

### 3. Performance Tests
- Measure execution time for 1000 candles
- Test memory usage with large datasets
- Verify cache effectiveness

## Migration Path

1. **Keep Mock as Fallback**: Add a flag to toggle between mock and real execution
2. **Gradual Rollout**: Test with one strategy before enabling for all
3. **Debugging Mode**: Add verbose logging for component execution

```rust
pub struct BacktestConfig {
    pub use_mock_signals: bool,  // Toggle for testing
    // ... other fields
}
```

## Example Component Updates

### Update MA Crossover Signal

```python
# ma_crossover.py
import os
import json
import pandas as pd

# Get data from environment
candle_data = json.loads(os.environ.get('CANDLE_DATA', '[]'))
current_index = int(os.environ.get('CURRENT_INDEX', '0'))

# Create DataFrame
df = pd.DataFrame(candle_data[:current_index + 1])
df['time'] = pd.to_datetime(df['time'], unit='s')

# Calculate MAs
fast_ma = df['close'].rolling(window=20).mean()
slow_ma = df['close'].rolling(window=50).mean()

# Detect crossover
if len(df) >= 50:
    current_fast = fast_ma.iloc[-1]
    current_slow = slow_ma.iloc[-1]
    prev_fast = fast_ma.iloc[-2]
    prev_slow = slow_ma.iloc[-2]
    
    signals = []
    
    if prev_fast <= prev_slow and current_fast > current_slow:
        signals.append({
            "timestamp": df['time'].iloc[-1].isoformat(),
            "signal_type": "golden_cross",
            "strength": 0.85,
            "metadata": {
                "fast_ma": current_fast,
                "slow_ma": current_slow
            }
        })
    
    print("SIGNAL_START")
    print(json.dumps(signals))
    print("SIGNAL_END")
```

## Success Criteria

1. **Functional**: Real strategies produce trades based on actual signals
2. **Performance**: Backtest of 1 year completes in < 30 seconds
3. **Accurate**: Results match manual calculation verification
4. **Maintainable**: Clear separation between execution and evaluation

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Python execution overhead | Slow backtests | Implement caching and parallel execution |
| Component failures | Backtest crashes | Comprehensive error handling |
| Memory usage | OOM on large datasets | Stream data instead of loading all |
| Output parsing errors | Wrong signals | Strict validation and testing |

## Next Steps After Implementation

1. **Update Documentation**: Document the new execution flow
2. **Create Examples**: Provide template components that work with the new system
3. **Performance Tuning**: Profile and optimize bottlenecks
4. **UI Updates**: Show component execution progress in UI

This implementation will transform the orchestrator from a demo system to a production-ready backtesting engine capable of running real trading strategies.