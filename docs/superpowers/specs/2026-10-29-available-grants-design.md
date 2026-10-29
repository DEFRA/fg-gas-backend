# Available grants for an applicant

FGP-1552 adds a GAS API for Grants UI to discover the grant codes available
to a signed-in applicant. Grants UI changes belong to another team.

## Contract

- `GET /api/allow-list/grants/sbi/{sbi}/crn/{crn}`.
- Authenticate the calling service and identify the caller using the existing
  single-grant allowlist API conventions.
- Require a nine-digit SBI and ten-digit CRN, preserving leading zeroes.
  Reject missing or invalid identifiers and unexpected query parameters.
- Return `200` with `{ "grants": [{ "code": "example-grant" }] }`.
  Return `{ "grants": [] }` when no grants are available.
- Omit title, description and URL. Display metadata remains undecided.
- Return each code once, sorted by code for deterministic results.
- Disable response caching, following the existing API.

## Domain behaviour

Consider grants with an Active Config Version, selecting the latest Active
version across all majors as the existing unversioned single-grant check does.
Draft-only grants are not candidates.

`GrantAccess`, `GrantSettings` and `GrantAllowList` continue to own access
decisions. A grant must be open; absent settings mean closed. An absent
allowlist is unrestricted. Each populated identifier restriction must match.
The bulk use case orchestrates these models without duplicating their rules
in Mongo queries or HTTP handlers.

Closed grants can be excluded before loading their definitions. For open
candidates, use the same definition resolution and loading semantics as the
single-grant API, including fetching an unstored current definition. A required
definition that cannot load, malformed required stored state, or a dependency
failure fails the whole request. Do not return partial success or fall back to
an older definition.

## Approaches

The agreed approach is batched reads and fresh access decisions. Discover
current candidates and retrieve settings, allowlists and stored definitions in
batches where practical. Keep any necessary per-grant definition fetching
bounded. Reuse the current resolution/loading behaviour without a chain of
database calls for every already-stored grant.

Calling the existing single-grant use case repeatedly would preserve behaviour
but repeat queries and audit work. Caching applicant-specific results would
reduce reads but introduce stale access decisions and invalidation complexity.
Neither fits the requested modest, practical performance improvements.

No new dependency or applicant-result cache is needed. Follow existing error
and audited-read conventions, recording the service caller, applicant and
outcome. Keep the single-grant contract intact.

## TDD and verification

Use one failing behavioural test followed by the smallest implementation per
slice. The agreed boundaries are authenticated HTTP requests, public domain
access decisions, Mongo-backed bulk reads, and the GAS response contract
consumed by Grants UI. No Grants UI files will change.

Cover open and closed grants, both identifier restrictions, unrestricted grants,
missing settings, empty results, latest Active version selection, definition
failures, service authentication, validation, auditing, and parity with the
single-grant access decision. Exercise real Mongo-backed bulk reads and check
the query approach for per-grant work rather than asserting timing thresholds.
Run the relevant tests, then the project test suite and lint/format checks.

## Builder decisions

Candidate discovery, sorting, excluding closed grants before definition loading,
and bounded loading are implementation proposals supporting the agreed scope.
Exact helper names and batch query structure remain implementation choices.
