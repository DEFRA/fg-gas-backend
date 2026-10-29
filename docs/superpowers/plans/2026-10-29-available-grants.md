# Available Grants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Return the grant codes available to an applicant through a service-authenticated GAS endpoint.

**Architecture:** Batch current-version, settings, allowlist and stored-grant reads; use existing domain models for every access decision. Share the existing definition loader for candidates that need fetching and preserve its failure semantics. Wrap the bulk use case in the existing committed-audit read boundary.

**Tech Stack:** JavaScript ES modules, Hapi, Joi, MongoDB, Vitest, mongodb-memory-server.

**Spec:** `docs/superpowers/specs/2026-10-29-available-grants-design.md`

## Global Constraints

- GAS only. No Grants UI changes or new dependencies.
- `GET /api/allow-list/grants/sbi/{sbi}/crn/{crn}` returns `{ "grants": [{ "code": "example-grant" }] }`.
- Omit title, description and URL. Return unique codes sorted by code.
- Nine-digit SBI and ten-digit CRN remain strings; reject unexpected query parameters.
- Missing settings mean closed; missing allowlist means unrestricted.
- Select latest Active Config Version across all majors; exclude draft-only and closed grants.
- A required definition or storage failure fails the request; no partial success or older-version fallback.
- Fresh decisions on every request, no response cache, no applicant-result cache.
- Write one failing behavioural test, observe the expected failure, implement minimally, and verify green before the next slice.
- Test only the agreed HTTP, domain-decision, Mongo bulk-read and GAS response boundaries.

## Review Focus

- A newer broken Active version must fail rather than expose an older stored grant: Task 2.
- Closed grants must not fetch broken or pending definitions: Task 2.
- Grant closures and restriction changes must take effect on the next request: Task 2.
- Missing bulk identifiers must not be mistaken for a single-grant request: Task 3.
- Audit failure must withhold the result, including an empty result: Task 3.

### Task 1: Mongo-backed candidate and batch reads

**Files:**

- Modify: `src/grants/repositories/config-version.repository.js`
- Modify: `src/grants/repositories/grant-settings.repository.js`
- Modify: `src/grants/repositories/grant-allow-list.repository.js`
- Modify: `src/grants/repositories/grant.repository.js`
- Create: `src/grants/repositories/available-grants.integration.test.js`

**Interfaces:**

- Produce `findLatestActiveForAll()` returning one `ConfigVersion` per grant, selected by descending major/minor/patch with no failed-definition filter.
- Produce settings and allowlist `findByGrantCodes(grantCodes)` returning model collections.
- Produce `findByCodesAndVersions(versions)` returning stored `Grant` models for the exact `{ grantCode, version }` pairs, without matching another version of the same grant.

- [x] Seed real Mongo with active `woodland` versions `1.0.0`, `2.0.0`, `2.0.1` and inactive `3.0.0`; assert the public bulk read selects only `2.0.1`. Include a separate draft-only grant and assert it is absent. Run the test and observe failure before adding the query.
- [x] Implement the current-version query in the repository; rerun the test and existing config-version repository tests.
- [x] In separate red/green slices, test settings and allowlist batch reads against requested codes, absent records and malformed persisted state. Implement collection reads that hydrate existing models and preserve their validation.
- [x] Test exact-pair grant loading with two codes and multiple versions; assert returned public model codes/versions equal the requested stored pairs. Implement the batch query and rerun repository tests.
- [x] Ensure empty batch inputs return empty collections without querying the database. Reuse existing indexes; inspect query shapes for accidental all-version or per-grant reads.

### Task 2: Audited bulk access decision

**Files:**

- Create: `src/grants/use-cases/get-available-grants.use-case.js`
- Extend: `src/grants/repositories/available-grants.integration.test.js`
- Modify as needed: `src/grants/services/resolve-config-version.service.js`
- Modify: `src/events/audit-constants.js`

**Interfaces:**

- Consume Task 1 batch reads and existing `GrantAccess`, `GrantSettings`, `GrantAllowList` models.
- Produce `getAvailableGrantsUseCase({ sbi, crn, caller }) -> Promise<{ grants: Array<{ code: string }> }>`.
- If needed, expose a shared resolved-version loading helper from the existing resolver; the single-grant signature and behaviour remain unchanged.

- [x] Through the public use case with real Mongo data, seed one open unrestricted grant and assert `{ grants: [{ code: "woodland" }] }`. Observe failure, implement minimal orchestration, then verify green.
- [x] Add one slice at a time for no active candidates, closed/missing settings, empty results, populated SBI/CRN restrictions, and both restrictions together. Exercise the same applicants through the single-grant public use case and assert parity of successful decisions.
- [x] Add two open candidates inserted in reverse code order and assert unique sorted code-only output.
- [x] Add a newly published major between requests, then change settings and lists between requests; assert fresh results without stale decisions.
- [x] Seed a broken newest Active version above an older usable version; assert rejection with `502`, no fallback and a FAILURE audit. Implement loading through the existing guard/fetch path while batching the already-stored path.
- [x] For a pending open grant, mock only the external S3 boundary; assert a successful fetch produces its code, then separately assert transient S3 failure rejects the whole request with `503`.
- [x] Seed a closed pending/broken grant and assert successful exclusion without S3 fetching. Keep required fetching bounded (sequential fallback is sufficient for exceptional uncached candidates).
- [x] Assert malformed required settings/allowlists and database failure reject the request. Reuse `auditedRead` and a dedicated `GET_AVAILABLE_GRANTS` action with applicant accounts, caller and returned codes following existing audit conventions.
- [x] Run the bulk integration tests, existing single-grant use-case tests, domain access tests and resolver service tests. Inspect the warm path for a fixed number of batch reads and no per-grant resolver calls.

### Task 3: HTTP endpoint, validation and delivery checks

**Files:**

- Create: `src/grants/routes/get-available-grants.route.js`
- Create: `src/grants/routes/get-available-grants.route.test.js`
- Create: `src/grants/schemas/requests/get-available-grants-request.schema.js`
- Create: `src/grants/schemas/responses/get-available-grants-response.schema.js`
- Modify: `src/grants/index.js`
- Modify: `src/grants/index.test.js`
- Extend: `src/grants/repositories/available-grants.integration.test.js`
- Modify: `README.md`
- Modify: `api.http`

**Interfaces:**

- Consume `getAvailableGrantsUseCase({ sbi, crn, caller })`.
- Expose the exact GET contract in Global Constraints, including appropriate missing-identifier routes.

- [x] Inject the canonical request through an authenticated Hapi server and assert `200`, `{ grants: [{ code: "woodland" }] }`, no display fields, and `Cache-Control` containing `no-store`. Observe failure before implementing the route, schemas and registration.
- [x] Add individual red/green slices for missing SBI/CRN, malformed identifiers, unknown query parameters and unauthenticated callers. Preserve leading zeroes. Register alongside existing routes and prove both bulk and single-grant paths still work.
- [x] Through real HTTP and Mongo, assert a SUCCESS audit includes caller, applicant accounts and result codes. Assert definition failure produces the appropriate error and FAILURE audit.
- [x] Force the audit write/commit to fail and assert HTTP does not release either populated or empty results. Follow the existing audit transaction boundary, without spanning S3 calls.
- [x] Update route registration expectations, README and HTTP examples to document code-only results and service authentication.
- [x] Run targeted tests, `npm test`, `npm run lint`, and `npx prettier --check` on changed files. Report any environmental blockers and failing tests by name; do not claim passing checks without their output.
- [x] Review the final diff against the approved design, particularly batch reads, unchanged single-grant behaviour and fail-whole-request semantics.
- [x] Before any staging, commit, push or PR work, read both gitkeeper instructions required by this session and follow their delivery guardrails. Any PR is draft by default.

## Execution results

Implemented and independently reviewed in this worktree. The final unit suite
passes: 344 files, 4,786 tests, including real Mongo-backed bulk reads and
HTTP/authentication/audit tests. Formatting and diff whitespace checks pass.
Lint passes from a visible-path copy of the same source; direct worktree lint
hits existing glob-exception failures caused by the hidden `.t3` path.

`npm test` reached Docker integration setup, which could not access the Docker
daemon socket (permission denied even outside the sandbox). That phase remains
unverified. No commit, push, or pull request was requested or performed; the
independent review explicitly covered tracked changes and new files.
