use super::types::{
    CandleSeriesTrustTier, CandleSeriesValidationViolation, EnforcementAction, ExecutionMode,
};

pub fn decide(
    mode: ExecutionMode,
    trust: CandleSeriesTrustTier,
    violations: &[CandleSeriesValidationViolation],
) -> (EnforcementAction, Vec<CandleSeriesValidationViolation>) {
    match mode {
        ExecutionMode::Research => (EnforcementAction::Allow, Vec::new()),
        ExecutionMode::Paper => {
            if violations
                .iter()
                .any(|v| matches!(v, CandleSeriesValidationViolation::NotOrdered))
            {
                (
                    EnforcementAction::Warn,
                    vec![CandleSeriesValidationViolation::NotOrdered],
                )
            } else {
                (EnforcementAction::Allow, Vec::new())
            }
        }
        ExecutionMode::Live => match trust {
            CandleSeriesTrustTier::Verified => {
                let mut blocking = Vec::new();
                for violation in violations {
                    if matches!(
                        violation,
                        CandleSeriesValidationViolation::NotOrdered
                            | CandleSeriesValidationViolation::OhlcSanityUnknown
                            | CandleSeriesValidationViolation::TimeframeAlignmentUnknown
                            | CandleSeriesValidationViolation::TimeframeMisaligned
                    ) {
                        blocking.push(*violation);
                    }
                }
                if blocking.is_empty() {
                    (EnforcementAction::Allow, Vec::new())
                } else {
                    (EnforcementAction::Block, blocking)
                }
            }
            CandleSeriesTrustTier::External => {
                if violations
                    .iter()
                    .any(|v| matches!(v, CandleSeriesValidationViolation::NotOrdered))
                {
                    (
                        EnforcementAction::Block,
                        vec![CandleSeriesValidationViolation::NotOrdered],
                    )
                } else if violations.is_empty() {
                    (EnforcementAction::Allow, Vec::new())
                } else {
                    (EnforcementAction::Warn, violations.to_vec())
                }
            }
            CandleSeriesTrustTier::UserSupplied => {
                if violations.is_empty() {
                    (EnforcementAction::Allow, Vec::new())
                } else {
                    (EnforcementAction::Block, violations.to_vec())
                }
            }
        },
    }
}
