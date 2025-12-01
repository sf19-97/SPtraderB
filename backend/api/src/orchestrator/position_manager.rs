use super::types::{Position, PositionSide, Portfolio, Trade};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use std::collections::HashMap;

pub struct PositionManager {
    open_positions: HashMap<String, Position>,
}

impl PositionManager {
    pub fn new() -> Self {
        Self {
            open_positions: HashMap::new(),
        }
    }

    /// Open a new position
    pub fn open_position(
        &mut self,
        symbol: String,
        side: PositionSide,
        price: Decimal,
        size: Decimal,
        timestamp: DateTime<Utc>,
        triggering_signal: String,
        stop_loss: Option<Decimal>,
        take_profit: Option<Decimal>,
    ) -> Position {
        let position_id = format!("{}-{}", symbol, timestamp.timestamp());

        let position = Position {
            id: position_id.clone(),
            symbol: symbol.clone(),
            side,
            entry_price: price,
            size,
            entry_time: timestamp,
            triggering_signal,
            stop_loss,
            take_profit,
        };

        tracing::info!(
            "Opening {} position on {} at {} (size: {})",
            match side {
                PositionSide::Long => "LONG",
                PositionSide::Short => "SHORT",
            },
            symbol,
            price,
            size
        );

        self.open_positions.insert(position_id, position.clone());
        position
    }

    /// Check all open positions for stop-loss or take-profit hits
    pub fn check_risk_exits(
        &mut self,
        current_prices: &HashMap<String, Decimal>,
        timestamp: DateTime<Utc>,
    ) -> Vec<Trade> {
        let mut completed_trades = Vec::new();

        let positions_to_close: Vec<String> = self
            .open_positions
            .iter()
            .filter_map(|(id, position)| {
                let current_price = match current_prices.get(&position.symbol) {
                    Some(price) => price,
                    None => return None,
                };

                // Check stop-loss
                if let Some(stop_loss_pct) = position.stop_loss {
                    let stop_loss_price = match position.side {
                        PositionSide::Long => {
                            position.entry_price * (Decimal::ONE - stop_loss_pct)
                        }
                        PositionSide::Short => {
                            position.entry_price * (Decimal::ONE + stop_loss_pct)
                        }
                    };

                    let hit_stop_loss = match position.side {
                        PositionSide::Long => *current_price <= stop_loss_price,
                        PositionSide::Short => *current_price >= stop_loss_price,
                    };

                    if hit_stop_loss {
                        tracing::info!(
                            "Stop-loss hit for {} at {} (SL: {})",
                            position.symbol,
                            current_price,
                            stop_loss_price
                        );
                        return Some(id.clone());
                    }
                }

                // Check take-profit
                if let Some(take_profit_pct) = position.take_profit {
                    let take_profit_price = match position.side {
                        PositionSide::Long => {
                            position.entry_price * (Decimal::ONE + take_profit_pct)
                        }
                        PositionSide::Short => {
                            position.entry_price * (Decimal::ONE - take_profit_pct)
                        }
                    };

                    let hit_take_profit = match position.side {
                        PositionSide::Long => *current_price >= take_profit_price,
                        PositionSide::Short => *current_price <= take_profit_price,
                    };

                    if hit_take_profit {
                        tracing::info!(
                            "Take-profit hit for {} at {} (TP: {})",
                            position.symbol,
                            current_price,
                            take_profit_price
                        );
                        return Some(id.clone());
                    }
                }

                None
            })
            .collect();

        // Close positions that hit SL/TP
        for position_id in positions_to_close {
            if let Some(position) = self.open_positions.remove(&position_id) {
                let current_price = current_prices[&position.symbol];
                let trade = Self::create_trade_from_position(position, current_price, timestamp);
                completed_trades.push(trade);
            }
        }

        completed_trades
    }

    /// Close all open positions
    pub fn close_all_positions(
        &mut self,
        current_prices: &HashMap<String, Decimal>,
        timestamp: DateTime<Utc>,
    ) -> Vec<Trade> {
        let mut completed_trades = Vec::new();

        for (_, position) in self.open_positions.drain() {
            let current_price = match current_prices.get(&position.symbol) {
                Some(price) => *price,
                None => {
                    tracing::warn!(
                        "No current price for {}, using entry price",
                        position.symbol
                    );
                    position.entry_price
                }
            };

            let trade = Self::create_trade_from_position(position, current_price, timestamp);
            completed_trades.push(trade);
        }

        completed_trades
    }

    /// Close positions for a specific symbol
    pub fn close_positions_for_symbol(
        &mut self,
        symbol: &str,
        current_price: Decimal,
        timestamp: DateTime<Utc>,
    ) -> Vec<Trade> {
        let mut completed_trades = Vec::new();

        let positions_to_close: Vec<String> = self
            .open_positions
            .iter()
            .filter_map(|(id, pos)| {
                if pos.symbol == symbol {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();

        for position_id in positions_to_close {
            if let Some(position) = self.open_positions.remove(&position_id) {
                let trade = Self::create_trade_from_position(position, current_price, timestamp);
                completed_trades.push(trade);
            }
        }

        completed_trades
    }

    /// Helper to create a Trade from a closed Position
    fn create_trade_from_position(
        position: Position,
        exit_price: Decimal,
        exit_time: DateTime<Utc>,
    ) -> Trade {
        let pnl = match position.side {
            PositionSide::Long => (exit_price - position.entry_price) * position.size,
            PositionSide::Short => (position.entry_price - exit_price) * position.size,
        };

        let pnl_percent = match position.side {
            PositionSide::Long => (exit_price - position.entry_price) / position.entry_price,
            PositionSide::Short => (position.entry_price - exit_price) / position.entry_price,
        };

        let holding_period = exit_time.signed_duration_since(position.entry_time);
        let holding_period_hours = holding_period.num_hours() as f64
            + (holding_period.num_minutes() % 60) as f64 / 60.0;

        // Determine exit reason based on position SL/TP
        let exit_reason = if position.stop_loss.is_some() && pnl < Decimal::ZERO {
            "stop_loss".to_string()
        } else if position.take_profit.is_some() && pnl > Decimal::ZERO {
            "take_profit".to_string()
        } else {
            "signal".to_string()
        };

        tracing::info!(
            "Closing {} position: {} -> {} | P&L: {} ({:.2}%) | Reason: {}",
            match &position.side {
                PositionSide::Long => "LONG",
                PositionSide::Short => "SHORT",
            },
            position.entry_price,
            exit_price,
            pnl,
            pnl_percent * Decimal::from(100),
            exit_reason
        );

        Trade {
            id: position.id,
            symbol: position.symbol,
            side: position.side,
            entry_price: position.entry_price,
            exit_price,
            quantity: position.size,
            entry_time: position.entry_time,
            exit_time,
            pnl,
            pnl_percent,
            exit_reason,
            holding_period_hours,
        }
    }

    /// Get current open positions count
    pub fn open_positions_count(&self) -> usize {
        self.open_positions.len()
    }

    /// Check if there are any open positions for a symbol
    pub fn has_open_positions_for(&self, symbol: &str) -> bool {
        self.open_positions.values().any(|pos| pos.symbol == symbol)
    }

    /// Execute a buy order
    pub fn execute_buy(
        &mut self,
        portfolio: &mut Portfolio,
        symbol: String,
        price: Decimal,
        size_percent: Decimal,
        timestamp: DateTime<Utc>,
        triggering_signal: String,
        stop_loss: Option<Decimal>,
        take_profit: Option<Decimal>,
    ) -> Option<Position> {
        // Calculate position size in base currency
        let capital_to_use = portfolio.cash * size_percent;
        let position_size = capital_to_use / price;

        if capital_to_use <= Decimal::ZERO || position_size <= Decimal::ZERO {
            tracing::warn!("Insufficient capital for buy order");
            return None;
        }

        // Deduct from cash
        portfolio.cash -= capital_to_use;

        // Open position
        let position = self.open_position(
            symbol,
            PositionSide::Long,
            price,
            position_size,
            timestamp,
            triggering_signal,
            stop_loss,
            take_profit,
        );

        Some(position)
    }

    /// Execute a sell order (short)
    pub fn execute_sell(
        &mut self,
        portfolio: &mut Portfolio,
        symbol: String,
        price: Decimal,
        size_percent: Decimal,
        timestamp: DateTime<Utc>,
        triggering_signal: String,
        stop_loss: Option<Decimal>,
        take_profit: Option<Decimal>,
    ) -> Option<Position> {
        // Calculate position size
        let capital_to_use = portfolio.cash * size_percent;
        let position_size = capital_to_use / price;

        if capital_to_use <= Decimal::ZERO || position_size <= Decimal::ZERO {
            tracing::warn!("Insufficient capital for sell order");
            return None;
        }

        // For shorts, we receive the capital (simplified model)
        portfolio.cash += capital_to_use;

        // Open short position
        let position = self.open_position(
            symbol,
            PositionSide::Short,
            price,
            position_size,
            timestamp,
            triggering_signal,
            stop_loss,
            take_profit,
        );

        Some(position)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_stop_loss_hit() {
        let mut manager = PositionManager::new();

        let position = manager.open_position(
            "EURUSD".to_string(),
            PositionSide::Long,
            Decimal::from_str("1.1000").unwrap(),
            Decimal::from_str("1000").unwrap(),
            Utc::now(),
            "test_signal".to_string(),
            Some(Decimal::from_str("0.02").unwrap()), // 2% SL
            None,
        );

        let mut current_prices = HashMap::new();
        current_prices.insert(
            "EURUSD".to_string(),
            Decimal::from_str("1.0780").unwrap(), // Hit SL
        );

        let trades = manager.check_risk_exits(&current_prices, Utc::now());
        assert_eq!(trades.len(), 1);
        assert!(trades[0].pnl < Decimal::ZERO);
    }
}
