CandleSeries v1 — Execution Data Contract

CandleSeries v1 guarantees:

Schema:

- time: Unix epoch seconds (UTC)
- open, high, low, close: finite numeric values
- volume: optional numeric (defaults to 0)
- records are immutable once accepted

Time semantics:

- timestamps are UTC
- candles are strictly chronological
- no internal sorting is performed
- no resampling or interpolation occurs

Alignment:

- all signals must share exact candle timestamps
- alignment by equality only (no tolerance windows)
- missing candles are treated as absences, not filled

Quality guarantees:

- no NaN / infinite values
- high >= max(open, close)
- low <= min(open, close)

Execution guarantees:

- execution engines may assume:
  - ordered input
  - stable cadence
  - aligned indicator outputs

ENFORCEMENT STATUS:

- CandleSeries v1 defines execution assumptions
  - in v1, these guarantees are trust-based and enforced upstream or by convention, not fully revalidated at execution time.

Capabilities (self-description):

- Every CandleSeries carries capability claims (non-enforcing, producer-declared):
  - ordered: bool
  - cadence_known: bool
  - gap_information: Unknown | KnownComplete | KnownWithGaps
  - ohlc_sanity_known: bool
- v1 default claims:
  - ordered = true
  - cadence_known = false
  - gap_information = Unknown
  - ohlc_sanity_known = false
- These are statements of belief, not runtime checks or guarantees.

Not enforced in v1 (by design):

- ordering
- cadence
- gaps
- OHLC envelope
- provenance

## Non-Goals (CandleSeries v1)

CandleSeries v1 intentionally does NOT:

- Verify chronological ordering
- Detect or repair gaps
- Enforce cadence consistency
- Validate OHLC envelope integrity
- Perform resampling or interpolation
- Attach provenance or trust metadata
- Perform alignment or joining with other series

These behaviors are assumed to be handled upstream
or by convention and are explicitly out of scope for v1.

## Version Boundary

Any change that introduces one or more of the following
requires a new CandleSeries version:

- Explicit cadence or gap awareness
- Built-in ordering or uniqueness enforcement
- OHLC integrity validation
- Alignment policies or tolerance windows
- Multi-clock or event-based semantics
- Provenance or trust classification
- Mutable or streaming candle semantics
