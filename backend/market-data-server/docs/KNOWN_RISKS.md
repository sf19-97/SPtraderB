# Known Risks (R2 Data Pipeline)

- **Legacy corrupted tick data**: Earlier runs mixed legacy misaligned data with normalized batches (`ticks-normalized/*`). Any rebuild must start from a clean prefix (e.g., delete `ticks-normalized/<SYMBOL>` and re-import fresh ticks).
- **Deleted raw AUDUSD ticks**: `ticks/AUDUSD` was wiped; a full re-import is required before downstream steps (normalize/migrate).
- **Candles removed**: `candles/AUDUSD` was cleared; they must be regenerated after a clean tick import.
- **Timezone assumption clarified**: Dukascopy timestamps are UTC (verified via direct fetch: first tick 00:00Z, last ~22:59Z). Do not apply TZ shifts; treat source_tz as UTC.
- **Cloud-side changes are destructive**: Running imports/migrations against R2 directly will overwrite prefixes. Always target the correct prefix (`ticks`, `ticks-normalized`, `candles`) and back up if unsure.
- **Credential handling**: R2 credentials must be provided via environment (not committed): `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`. Wrong values can write to the wrong account/bucket.
