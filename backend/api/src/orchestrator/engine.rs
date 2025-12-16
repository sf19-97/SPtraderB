use super::data::fetch_historical_candles;
use super::position_manager::PositionManager;
use super::python_executor::execute_python_backtest;
use super::signal_processor::{SignalProcessor, TradeAction};
use super::types::*;
use chrono::{DateTime, Utc};
use rust_decimal::prelude::*; // For ToPrimitive
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub struct BacktestEngine {
    strategy_config: StrategyConfig,
}

impl BacktestEngine {
    pub fn new(strategy_config: StrategyConfig) -> Self {
        Self { strategy_config }
    }

    /// Load strategy from YAML content
    pub fn from_yaml(yaml_content: &str) -> Result<Self, String> {
        let strategy_config: StrategyConfig = serde_yaml::from_str(yaml_content)
            .map_err(|e| format!("Failed to parse strategy YAML: {}", e))?;

        Ok(Self::new(strategy_config))
    }

    /// Run backtest
    pub async fn run_backtest(
        &self,
        backtest_id: &str,
        symbol: &str,
        timeframe: &str,
        start_date: DateTime<Utc>,
        end_date: DateTime<Utc>,
        initial_capital: Decimal,
        requirement: CandleSeriesRequirement,
        cancel_flag: Option<Arc<AtomicBool>>,
        registry: Option<BacktestRegistry>,
    ) -> Result<BacktestResult, String> {
        tracing::info!(
            "Starting backtest for {} from {} to {}",
            symbol,
            start_date,
            end_date
        );

        // Declares the execution contract for this run; enforcement arrives in v2.
        let _execution_requirement = requirement;

        // Fetch historical candles from ws-market-data-server
        let candle_series = match fetch_historical_candles(symbol, timeframe, start_date, end_date)
            .await
        {
            Ok(series) => series,
            Err(e) => {
                if let Some(registry) = &registry {
                    update_backtest_state(
                        registry,
                        backtest_id,
                        Some("failed"),
                        None,
                        Some(e.clone()),
                    )
                    .await;
                }
                return Err(e);
            }
        };

        if candle_series.candles.is_empty() {
            if let Some(registry) = &registry {
                update_backtest_state(
                    registry,
                    backtest_id,
                    Some("failed"),
                    None,
                    Some("No candle data available for the specified period".to_string()),
                )
                .await;
            }
            return Err("No candle data available for the specified period".to_string());
        }

        tracing::info!(
            "Loaded {} candles for backtesting",
            candle_series.candles.len()
        );

        // Execute Python backtest to generate signals
        let signals = match execute_python_backtest(&candle_series, &self.strategy_config).await {
            Ok(signals) => signals,
            Err(e) => {
                if let Some(registry) = &registry {
                    update_backtest_state(
                        registry,
                        backtest_id,
                        Some("failed"),
                        None,
                        Some(e.clone()),
                    )
                    .await;
                }
                return Err(e);
            }
        };
        tracing::info!("Generated {} signals from Python backtest", signals.len());

        // Debug: Log all signals with their timestamps
        for signal in &signals {
            tracing::info!(
                "Signal: {} ({}) at {} - strength: {} - metadata: {:?}",
                signal.signal_name,
                signal.signal_type,
                signal.timestamp,
                signal.strength,
                signal.metadata
            );
        }

        // Initialize portfolio and tracking
        let mut portfolio = Portfolio::new(initial_capital);
        let risk_manager = RiskManager::from_strategy_config(&self.strategy_config);
        let mut completed_trades: Vec<Trade> = Vec::new();
        let mut daily_returns = Vec::new();

        // Initialize signal processor and position manager
        let signal_processor = SignalProcessor::new(signals.clone(), self.strategy_config.clone());
        let mut position_manager = PositionManager::new();

        // Track daily P&L
        let mut last_portfolio_value = initial_capital;
        let mut current_date = candle_series
            .candles
            .first()
            .map(|c| c.time.date_naive())
            .ok_or("No candles available")?;

        // Process candles chronologically
        // ASSUMES:
        // Input candles conform to CandleSeries v1 execution contract
        // (see orchestrator/DATA_CONTRACT.md).
        // No reordering, resampling, or gap-handling occurs here.
        for (candle_idx, candle) in candle_series.candles.iter().enumerate() {
            if let Some(flag) = &cancel_flag {
                if flag.load(Ordering::Relaxed) {
                    if let Some(registry) = &registry {
                        update_backtest_state(
                            registry,
                            backtest_id,
                            Some("cancelled"),
                            Some(calculate_progress(candle_idx, candle_series.candles.len())),
                            Some("Cancelled".to_string()),
                        )
                        .await;
                    }
                    return Err("Backtest cancelled".to_string());
                }
            }

            // Update portfolio date
            portfolio.current_date = candle.time;

            // Check for new day
            if candle.time.date_naive() != current_date {
                // Calculate daily return
            let daily_return =
                (portfolio.total_value - last_portfolio_value) / last_portfolio_value;
            daily_returns.push((candle.time, daily_return));

            // Reset for new day
            portfolio.daily_pnl = Decimal::ZERO;
            last_portfolio_value = portfolio.total_value;
                current_date = candle.time.date_naive();
            }

            // Build current prices map
            let mut current_prices = HashMap::new();
            current_prices.insert(symbol.to_string(), candle.close);

            // Update portfolio value
            portfolio.update_value(&current_prices);

            // Check risk limits
            if let Err(risk_error) = risk_manager.check_risk_limits(&portfolio) {
                tracing::warn!(
                    "Risk limit hit at {}: {}",
                    candle.time.format("%Y-%m-%d"),
                    risk_error
                );
                break; // Stop trading if risk limits are hit
            }

            // STRATEGY EXECUTION LOGIC

            // 1. Check for stop-loss and take-profit hits on open positions
            let sl_tp_trades =
                position_manager.check_risk_exits(&mut portfolio, &current_prices, candle.time);
            completed_trades.extend(sl_tp_trades);

            // 2. Get signals at current timestamp
            let current_signals = signal_processor.get_signals_at(candle.time);

            if !current_signals.is_empty() {
                tracing::info!(
                    "Found {} signals at {} - {:?}",
                    current_signals.len(),
                    candle.time,
                    current_signals
                        .iter()
                        .map(|s| (&s.signal_name, &s.signal_type, &s.metadata))
                        .collect::<Vec<_>>()
                );
                // 3. Check for exit signals first
                match signal_processor.evaluate_exit(&current_signals) {
                    TradeAction::CloseAll => {
                        let closed_trades = position_manager.close_all_positions(
                            &mut portfolio,
                            &current_prices,
                            candle.time,
                        );
                        completed_trades.extend(closed_trades);
                    }
                    _ => {}
                }

                // 4. Check for entry signals (only if no position open for this symbol)
                if !position_manager.has_open_positions_for(symbol) {
                    let entry_action = signal_processor.evaluate_entry(&current_signals);
                    tracing::info!("Entry evaluation result: {:?}", entry_action);
                    match entry_action {
                        TradeAction::Buy { size_percent } => {
                            let signal_name = current_signals
                                .first()
                                .map(|s| s.signal_name.clone())
                                .unwrap_or_else(|| "unknown".to_string());

                            position_manager.execute_buy(
                                &mut portfolio,
                                symbol.to_string(),
                                candle.close,
                                size_percent,
                                candle.time,
                                signal_name,
                                signal_processor.get_stop_loss(),
                                signal_processor.get_take_profit(),
                            );
                        }
                        TradeAction::Sell { size_percent } => {
                            let signal_name = current_signals
                                .first()
                                .map(|s| s.signal_name.clone())
                                .unwrap_or_else(|| "unknown".to_string());

                            position_manager.execute_sell(
                                &mut portfolio,
                                symbol.to_string(),
                                candle.close,
                                size_percent,
                                candle.time,
                                signal_name,
                                signal_processor.get_stop_loss(),
                                signal_processor.get_take_profit(),
                            );
                        }
                        TradeAction::CloseAll | TradeAction::None => {}
                    }
                }
            }

            // Refresh portfolio valuation after any trades
            portfolio.update_value(&current_prices);

            // Emit progress every 100 candles
            if candle_idx % 100 == 0 {
                let progress = calculate_progress(candle_idx, candle_series.candles.len());
                tracing::debug!("Backtest progress: {:.1}%", progress);
                if let Some(registry) = &registry {
                    update_backtest_state(
                        registry,
                        backtest_id,
                        Some("running"),
                        Some(progress),
                        None,
                    )
                    .await;
                }
            }
        }

        // Add final day's return
        if !daily_returns.is_empty() {
            let daily_return =
                (portfolio.total_value - last_portfolio_value) / last_portfolio_value;
            daily_returns.push((
                candle_series.candles.last().unwrap().time,
                daily_return,
            ));
        }

        // Calculate final metrics
        let winning_trades = completed_trades
            .iter()
            .filter(|t| t.pnl > Decimal::ZERO)
            .count() as i32;
        let losing_trades = completed_trades
            .iter()
            .filter(|t| t.pnl < Decimal::ZERO)
            .count() as i32;
        let total_pnl = portfolio.total_value - portfolio.initial_capital;
        let sharpe_ratio = Self::calculate_sharpe_ratio(&daily_returns);

        tracing::info!(
            "Backtest complete: {} trades, {} wins, {} losses",
            completed_trades.len(),
            winning_trades,
            losing_trades
        );
        tracing::info!(
            "Final P&L: {} ({:.2}%), Sharpe: {:.2}",
            total_pnl,
            (total_pnl / initial_capital) * Decimal::from(100),
            sharpe_ratio
        );

        Ok(BacktestResult {
            total_trades: completed_trades.len() as i32,
            winning_trades,
            losing_trades,
            total_pnl,
            max_drawdown: portfolio.max_drawdown,
            sharpe_ratio,
            start_capital: initial_capital,
            end_capital: portfolio.total_value,
            signals_generated: signals.len() as u32,
            daily_returns,
            completed_trades,
        })
    }

    fn calculate_sharpe_ratio(daily_returns: &[(DateTime<Utc>, Decimal)]) -> f64 {
        if daily_returns.is_empty() {
            return 0.0;
        }

        let returns: Vec<f64> = daily_returns
            .iter()
            .filter_map(|(_, r)| r.to_f64())
            .collect();

        let mean = returns.iter().sum::<f64>() / returns.len() as f64;
        let variance =
            returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / returns.len() as f64;
        let std_dev = variance.sqrt();

        if std_dev == 0.0 {
            return 0.0;
        }

        // Annualized Sharpe Ratio (assuming 252 trading days)
        mean / std_dev * (252.0_f64).sqrt()
    }
}

fn calculate_progress(processed: usize, total: usize) -> f64 {
    if total == 0 {
        return 0.0;
    }
    (processed as f64 / total as f64) * 100.0
}

async fn update_backtest_state(
    registry: &BacktestRegistry,
    backtest_id: &str,
    status: Option<&str>,
    progress: Option<f64>,
    error: Option<String>,
) {
    let mut state = registry.write().await;
    if let Some(entry) = state.get_mut(backtest_id) {
        if let Some(status) = status {
            entry.status = status.to_string();
        }
        if let Some(progress) = progress {
            entry.progress = progress;
        }
        if let Some(error) = error {
            entry.error = Some(error);
        }
    }
}
