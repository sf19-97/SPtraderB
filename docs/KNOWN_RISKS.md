# Known Risks and Gaps (SPtraderB)

This file tracks major risks/tech debt to address. Severity is relative to production safety/UX.

## Security / Safety

- **Open API / CORS wide open (HIGH)**: All routes are unauthenticated and CORS allows any origin (`backend/api/src/main.rs`). Workspace file ops and run-component can be invoked by any browser. Action: add auth and restrict CORS; consider disabling run-component in prod.
- **Arbitrary Python execution without limits (HIGH)**: Backtests and `/api/workspace/run-component` execute user-provided Python with no timeouts or resource limits (`workspace/executor.rs`, `orchestrator/python_executor.rs`). Action: add timeouts, CPU/mem limits, and reject untrusted inputs in prod.
- **Cancellation is best-effort (MED)**: Cancel only sets a flag in Rust; Python subprocess and candle fetch are not cancelled (`orchestrator/engine.rs`, `python_executor.rs`). Action: terminate subprocess on cancel and propagate cancellation to data fetch.

## Reliability / Scaling

- **In-memory backtest status (MED)**: Registry lives in-process; restart loses status/progress (`main.rs`, `orchestrator/handlers.rs`). Action: persist status or rebuild from disk; consider a queue/state store.
- **Large payloads for results (MED)**: Full `completed_trades` list is returned and stored as one JSON blob; large backtests can bloat responses/memory. Action: paginate/stream trades; cap size.
- **Candle fetch is unbounded (MED)**: `fetch_historical_candles` pulls entire ranges in one request with no paging/timeouts/retries (`orchestrator/data.rs`). Action: add pagination/timeouts/retries.

## Risk/Trading Logic

- **Risk controls ineffective (MED)**: `daily_pnl` updates only on closes; no mark-to-market, so drawdown/daily loss limits don’t trip; position limits not enforced (`types.rs`, `position_manager.rs`). Action: MTM P&L each candle, enforce position/risk limits.
- **Position IDs may collide (LOW)**: IDs are `symbol-timestamp`, could clash under high frequency (`position_manager.rs`). Action: add randomness/monotonic counter.

## UX/Placeholders

- **Live/Performance/Risk/Orders tabs are placeholders (LOW)**: Orchestrator UI shows tabs with “coming soon.” Action: gate/disable or implement.

## Dead Code / Unused Deps

- **Unused deps/imports (LOW)**: `cargo-udeps` reports unused crates for API target: `arrow`, `parquet`, `dirs`, `futures`, `rust_decimal_macros`, `tokio-tungstenite`, `tower`. Many unused imports/re-exports and stub methods (`main.rs`, `orchestrator/mod.rs`, `position_manager.rs`, `python_executor.rs`, `workspace/operations.rs`). Action: remove or ignore intentionally used-in-future deps/imports; prune unused methods.

Last updated: 2025-12-02.
