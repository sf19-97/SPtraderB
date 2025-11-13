use super::types::{SignalEvent, StrategyConfig};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use rust_decimal::prelude::*;  // For from_f64
use std::str::FromStr;

#[derive(Debug, Clone)]
pub enum TradeAction {
    Buy { size_percent: Decimal },
    Sell { size_percent: Decimal },
    CloseAll,
    None,
}

pub struct SignalProcessor {
    signals: Vec<SignalEvent>,
    strategy_config: StrategyConfig,
}

impl SignalProcessor {
    pub fn new(signals: Vec<SignalEvent>, strategy_config: StrategyConfig) -> Self {
        Self {
            signals,
            strategy_config,
        }
    }

    /// Find signals that match the current timestamp
    pub fn get_signals_at(&self, timestamp: DateTime<Utc>) -> Vec<&SignalEvent> {
        self.signals
            .iter()
            .filter(|s| s.timestamp == timestamp)
            .collect()
    }

    /// Evaluate entry rules against current signals
    pub fn evaluate_entry(&self, current_signals: &[&SignalEvent]) -> TradeAction {
        // Get entry configuration
        let entry = &self.strategy_config.entry;

        // Check if entry has "when" conditions
        let when_conditions = match entry.get("when").and_then(|v| v.as_sequence()) {
            Some(conditions) => conditions,
            None => return TradeAction::None,
        };

        // Check each condition
        for condition in when_conditions {
            let signal_name = match condition.get("signal").and_then(|v| v.as_str()) {
                Some(name) => name,
                None => continue,
            };

            let required_outputs = condition.get("outputs");

            // Find matching signal in current signals
            let matching_signal = current_signals.iter().find(|s| {
                // Check signal name match
                if !s.signal_name.contains(signal_name) && s.signal_name != signal_name {
                    return false;
                }

                // Check output conditions if specified
                if let Some(required_outputs) = required_outputs {
                    if let Some(outputs_obj) = required_outputs.as_mapping() {
                        for (key, value) in outputs_obj {
                            // Convert yaml key to string
                            if let Some(key_str) = key.as_str() {
                                // Convert yaml value to json value for comparison
                                let value_json: serde_json::Value = match serde_yaml::from_value(value.clone()) {
                                    Ok(v) => v,
                                    Err(_) => return false,
                                };
                                let signal_value = s.metadata.get(key_str);
                                if signal_value != Some(&value_json) {
                                    return false;
                                }
                            }
                        }
                    }
                }

                true
            });

            if matching_signal.is_some() {
                // Get action (buy/sell)
                let action = entry
                    .get("action")
                    .and_then(|v| v.as_str())
                    .unwrap_or("buy");

                // Get position size
                let size = entry
                    .get("size")
                    .and_then(|v| v.as_f64())
                    .and_then(Decimal::from_f64)
                    .unwrap_or(Decimal::from_str("0.01").unwrap());

                return match action {
                    "buy" => TradeAction::Buy {
                        size_percent: size,
                    },
                    "sell" => TradeAction::Sell {
                        size_percent: size,
                    },
                    _ => TradeAction::None,
                };
            }
        }

        TradeAction::None
    }

    /// Evaluate exit rules against current signals
    pub fn evaluate_exit(&self, current_signals: &[&SignalEvent]) -> TradeAction {
        // Get exit configuration
        let exit = &self.strategy_config.exit;

        // Check signal-based exit
        if let Some(signal_exit) = exit.get("signal_exit") {
            if let Some(when_conditions) = signal_exit.get("when").and_then(|v| v.as_sequence()) {
                for condition in when_conditions {
                    let signal_name = match condition.get("signal").and_then(|v| v.as_str()) {
                        Some(name) => name,
                        None => continue,
                    };

                    let required_outputs = condition.get("outputs");

                    // Find matching signal
                    let matching_signal = current_signals.iter().find(|s| {
                        if !s.signal_name.contains(signal_name) && s.signal_name != signal_name {
                            return false;
                        }

                        if let Some(required_outputs) = required_outputs {
                            if let Some(outputs_obj) = required_outputs.as_mapping() {
                                for (key, value) in outputs_obj {
                                    // Convert yaml key to string
                                    if let Some(key_str) = key.as_str() {
                                        // Convert yaml value to json value for comparison
                                        let value_json: serde_json::Value = match serde_yaml::from_value(value.clone()) {
                                            Ok(v) => v,
                                            Err(_) => return false,
                                        };
                                        let signal_value = s.metadata.get(key_str);
                                        if signal_value != Some(&value_json) {
                                            return false;
                                        }
                                    }
                                }
                            }
                        }

                        true
                    });

                    if matching_signal.is_some() {
                        let action = signal_exit
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("close_all");

                        if action == "close_all" {
                            return TradeAction::CloseAll;
                        }
                    }
                }
            }
        }

        TradeAction::None
    }

    /// Get stop loss percentage from strategy config
    pub fn get_stop_loss(&self) -> Option<Decimal> {
        self.strategy_config
            .exit
            .get("stop_loss")
            .and_then(|sl| sl.get("value"))
            .and_then(|v| v.as_f64())
            .and_then(Decimal::from_f64)
    }

    /// Get take profit percentage from strategy config
    pub fn get_take_profit(&self) -> Option<Decimal> {
        self.strategy_config
            .exit
            .get("take_profit")
            .and_then(|tp| tp.get("value"))
            .and_then(|v| v.as_f64())
            .and_then(Decimal::from_f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entry_evaluation() {
        let mut metadata = std::collections::HashMap::new();
        metadata.insert(
            "crossover_type".to_string(),
            serde_json::Value::String("golden_cross".to_string()),
        );

        let signal = SignalEvent {
            timestamp: Utc::now(),
            signal_name: "ma_crossover".to_string(),
            signal_type: "bullish".to_string(),
            strength: 0.8,
            metadata,
        };

        // Create entry YAML value
        let entry_yaml = r#"
when:
  - signal: ma_crossover
    outputs:
      crossover_type: golden_cross
action: buy
size: 0.02
"#;
        let entry: serde_yaml::Value = serde_yaml::from_str(entry_yaml).unwrap();

        let strategy_config = StrategyConfig {
            name: "test".to_string(),
            version: "1.0".to_string(),
            author: "test".to_string(),
            description: "test".to_string(),
            entry,
            exit: serde_yaml::Value::Null,
            dependencies: super::super::types::Dependencies {
                indicators: vec![],
                signals: vec![],
            },
            parameters: std::collections::HashMap::new(),
            risk: std::collections::HashMap::new(),
            signal_config: std::collections::HashMap::new(),
        };

        let processor = SignalProcessor::new(vec![signal.clone()], strategy_config);
        let current_signals = vec![&signal];

        match processor.evaluate_entry(&current_signals) {
            TradeAction::Buy { size_percent } => {
                assert_eq!(size_percent, Decimal::from_str("0.02").unwrap());
            }
            _ => panic!("Expected Buy action"),
        }
    }
}
