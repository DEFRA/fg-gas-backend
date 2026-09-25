# Lightweight Decision Record - Development Payment Compatibility Scope

|                |             |
| -------------- | ----------- |
| status         | accepted    |
| date           | 25 Sep 2026 |
| decision maker | Justin      |

## Context

[LDR-004](./ldr-004-event-driven-payment-creation.md) made legacy Payment definition and full runtime-serialized CloudEvent parity prerequisites to Agreement cutover. That presumes a live Agreement scheme is being migrated. None is: `pigs-might-fly` is a compose seed/test grant and will not go to production; FPTT is closed. Woodland Payments may arrive through Claims in future, but there are no real Payments in the current development scope. The captured FPTT event is useful regression material, not evidence for a live migration.

## Decision

For the **current development-only Agreement cutover**, the LDR-004 gates requiring scheme-by-scheme comparison with legacy Agreement Payment definitions and executable parity with a legacy runtime-serialized CloudEvent are **not applicable**, rather than passed. Do not tick them as proven or call `pigs-might-fly` a migrated scheme. No live Agreement Payment traffic is authorised by this decision.

Keep the independent Payment Service interface obligations: validate the event envelope and Payment payload contract, one request with all scheduled payments, the local source-to-handler-to-SNS-to-GPS path, Agreement HTTP and lifecycle behaviour, idempotency, atomicity, and failure/recovery handling. A demo-grant transport test proves that local route, not legacy live-scheme parity. Resolve or explicitly disposition the incomplete full integration run separately; this decision does not turn it into a pass.

If a live Agreement scheme is later proposed for enablement, revisit its definition against the actual external Payment interface and obtain scheme-specific compatibility and deployment evidence **before** routing real traffic. Future Woodland Claim Payments need their own contract and rollout evidence; this decision does not approve them. LDR-004's per-environment subscription and deployment gates remain open.
