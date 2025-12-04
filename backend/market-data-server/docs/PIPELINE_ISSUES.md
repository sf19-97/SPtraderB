# Pipeline Time & Integrity Gaps

A concise list of systemic issues observed in the market data pipeline (ticks → R2 → candles → Postgres).

## Time & Session Modeling
- No broker/source timezone normalization: Dukascopy ticks arrive in Europe/Zurich, but we store/bucket as if they were UTC, shifting whole sessions into the wrong UTC day and causing missing bars.
- No session calendar per asset/venue: Candle builder assumes 24h Mon–Thu and 22h Fri. Holidays/early closes/venue-specific hours aren’t modeled, so validation and coverage expectations are wrong by design.
- R2 keying uses UTC dates while data is in local time; day partitions do not align to true trading sessions.

## Ingest / Storage
- Raw ticks are persisted without capturing source metadata (timezone, feed latency, first/last timestamp, record counts, checksum), making post-hoc validation and repair harder.
- Tick deduplication only uses timestamp; when sessions are offset, data bleeds into adjacent days and dedupe can hide mis-bucketing.
- No per-file/session manifest (counts, min/max ts, offset applied), so we can’t easily detect partial uploads or misaligned days.

## Candle Building & Migration
- Candle builder buckets strictly by UTC day with fixed 5m bar counts; it is not session-aware and cannot tolerate venue schedules or DST-shifted input.
- Integrity checks compare against fixed counts (288/264) rather than session calendars; failures are expected when input is offset or when holidays/early closes are legitimate.
- Migration processes entire months but aborts on day-level issues; there is no retry/skip mechanism per bad day, nor a path to rehydrate only the affected days.

## Validation & Observability
- Coverage checks in `verify` operate at the day level but don’t understand sessions/holidays; “missing” days may be due to offset or legitimate closures.
- No automated ingestion monitors (per day/per symbol) for min/max timestamps, bar counts, gaps, or anomaly thresholds.
- Lack of regression tests around time normalization and session handling; DST edge cases aren’t exercised.

## Operational/Architecture Gaps
- No configuration layer for per-broker/per-symbol timezones, sessions, and calendars; all logic is implicit in code.
- No tooling to normalize existing R2 data (one-time fix-up to adjust timestamps and re-key files).
- Candle artifacts can be orphaned/left stale when tick data is corrected; lifecycle management between ticks and derived candles is manual.
