# Enhanced Signal Metadata Architecture

## Overview

The Enhanced Signal Metadata Architecture (v2) enables signals to declare parameterized indicator requirements, allowing for complex multi-indicator signals without hardcoding indicator configurations in Rust. This document describes the architecture, implementation details, and migration guide.

## Motivation

The original metadata format only allowed signals to specify indicator names:
```python
'required_indicators': ['rsi', 'sma']  # But which SMA? What period?
```

This created ambiguity - how does the orchestrator know what parameters to use when instantiating indicators? The enhanced format solves this by allowing signals to fully specify their requirements.

## Architecture

### Metadata Version 2 Format

```python
__metadata_version__ = 2  # Required for enhanced format

__metadata__ = {
    'name': 'signal_name',
    'required_indicators': [
        {
            'name': 'indicator_alias',     # How signal references this indicator
            'type': 'indicator_type',      # Maps to indicator module (e.g., 'sma' → core.indicators.trend.sma)
            'params': {                     # Parameters to pass to indicator constructor
                'param1': value1,
                'param2': value2
            }
        }
    ],
    # ... rest of standard metadata
}
```

### Example: Moving Average Crossover

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

This tells the orchestrator:
1. Create an SMA with period=20, call it 'ma_fast'
2. Create an SMA with period=50, call it 'ma_slow'
3. Pass both to the signal's evaluate method

### Strategy-Level Overrides

Strategies can override signal defaults through `signal_config`:

```yaml
signal_config:
  ma_crossover:
    required_indicators:
      - name: ma_fast
        type: ema  # Changed from SMA to EMA!
        params: 
          period: parameters.ma_fast_period  # Reference strategy parameters
    parameters:
      min_separation: 0.0001  # Override signal parameter
```

This enables:
- Using the same signal with different indicator types
- Parameterizing indicator settings at the strategy level
- A/B testing different configurations

## Implementation Details

### Python Signal Contract

Signals using v2 metadata must:

1. Set `__metadata_version__ = 2`
2. Return the full metadata structure from `required_indicators` property:
   ```python
   @property
   def required_indicators(self) -> List[Any]:
       return __metadata__['required_indicators']
   ```
3. Expect indicators dict keys to match the 'name' fields

### Rust Orchestrator Design

```rust
// Core types
#[derive(Deserialize)]
struct IndicatorRequirement {
    name: String,
    #[serde(rename = "type")]
    indicator_type: String,
    params: HashMap<String, Value>,
}

#[derive(Deserialize)]
struct SignalMetadataV2 {
    version: u8,
    name: String,
    required_indicators: Vec<IndicatorRequirement>,
    // ... other fields
}

// Orchestration flow
async fn execute_signal(
    signal_path: &str,
    market_data: DataFrame,
    strategy_config: Option<StrategyConfig>,
) -> Result<SignalOutput> {
    // 1. Load signal metadata
    let metadata = load_signal_metadata(signal_path).await?;
    
    // 2. Apply strategy overrides if present
    let requirements = if let Some(config) = strategy_config {
        apply_overrides(metadata.required_indicators, config)?
    } else {
        metadata.required_indicators
    };
    
    // 3. Instantiate and run indicators
    let mut indicator_results = HashMap::new();
    for req in requirements {
        let indicator_path = resolve_indicator_path(&req.indicator_type)?;
        let result = run_indicator(indicator_path, &market_data, req.params).await?;
        indicator_results.insert(req.name, result);
    }
    
    // 4. Run signal with results
    run_signal(signal_path, market_data, indicator_results).await
}
```

### Indicator Type Resolution

The 'type' field maps to indicator modules following this convention:
- `'sma'` → `core.indicators.trend.sma`
- `'rsi'` → `core.indicators.momentum.rsi`
- `'bb'` → `core.indicators.volatility.bollinger_bands`

Custom mappings can be defined in a configuration file.

## Migration Guide

### Upgrading from v1 to v2

1. **Add version marker**:
   ```python
   __metadata_version__ = 2
   ```

2. **Convert required_indicators**:
   ```python
   # Old (v1)
   'required_indicators': ['rsi', 'sma']
   
   # New (v2)
   'required_indicators': [
       {'name': 'rsi', 'type': 'rsi', 'params': {'period': 14}},
       {'name': 'sma', 'type': 'sma', 'params': {'period': 20}}
   ]
   ```

3. **Update required_indicators property**:
   ```python
   @property
   def required_indicators(self) -> List[Any]:
       return __metadata__['required_indicators']
   ```

### Backward Compatibility

The orchestrator will support both v1 and v2 formats:
- v1 signals use default parameters from a configuration file
- v2 signals use their declared parameters
- Version detected by presence of `__metadata_version__`

## Benefits

1. **Self-Contained Signals**: All configuration in one place
2. **Type Safety**: Rust validates all parameters at runtime
3. **Flexibility**: Same signal works with different indicators
4. **No Hardcoding**: New indicator combinations without touching Rust
5. **Testing**: Easy to test signals with different parameters
6. **Documentation**: Metadata serves as documentation

## Advanced Features

### Dynamic Parameters

Indicators can reference market conditions:
```python
'params': {
    'period': {'type': 'adaptive', 'min': 10, 'max': 50, 'based_on': 'volatility'}
}
```

### Conditional Requirements

Indicators that depend on market state:
```python
'required_indicators': [
    {
        'name': 'trend_filter',
        'type': 'sma',
        'params': {'period': 200},
        'condition': 'only_in_trending_markets'
    }
]
```

### Multi-Timeframe

Indicators from different timeframes:
```python
'required_indicators': [
    {
        'name': 'daily_sma',
        'type': 'sma',
        'params': {'period': 20},
        'timeframe': '1d'
    },
    {
        'name': 'hourly_sma',
        'type': 'sma', 
        'params': {'period': 20},
        'timeframe': '1h'
    }
]
```

## Performance Considerations

1. **Caching**: Orchestrator caches indicator instances by parameter hash
2. **Lazy Loading**: Indicators only computed when needed
3. **Parallel Execution**: Independent indicators run concurrently
4. **Memory Management**: Results freed after signal execution

## Error Handling

The orchestrator validates:
- Indicator type exists
- Required parameters are provided
- Parameter types match expected
- No circular dependencies

Clear error messages guide users to fixes.

## Future Enhancements

### Version 3 Ideas
- Indicator pipelines (feed one indicator into another)
- Machine learning model requirements
- External data source requirements
- GPU acceleration hints

### Version 4 Ideas
- Distributed indicator computation
- Real-time streaming support
- Cloud indicator libraries
- AI-assisted parameter optimization

## Conclusion

The Enhanced Signal Metadata Architecture provides a powerful, flexible way to compose trading signals from indicators without touching orchestration code. By declaring requirements in metadata, signals become self-contained, testable, and infinitely composable.