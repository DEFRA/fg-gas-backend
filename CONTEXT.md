# Domain Model

The language this codebase is written in. Terms here are load-bearing: code,
tests and documentation should use them exactly, and a new concept earns a place
here before it earns a module name.

Bounded contexts and the seams between them live in
[docs/MODULE_BOUNDARIES.md](docs/MODULE_BOUNDARIES.md).

## Configuration

**Config Version** — a published version of a grant's configuration, identified
by grant code and semver. Announced by the Config Broker, recorded in
`config_versions`, and carrying the manifest of definition files it contains.

**Config Catalog** — the record of which definitions exist for a Config Version,
where each one lives in S3, and whether it has been fetched. Fetch failures are
recorded per definition type, so a broken Payment Definition does not mark the
Agreement Definition unusable.

**Definition Type** — the kind of definition a Config Version file carries:
`agreement` (`gas/agreement.json`) or `payment` (`gas/payment.json`). Recorded
against the Config Version, and used to resolve one definition independently of
the others.

**Definition Loader** — resolves one Definition Type from the Config Catalog:
picks a target version, fetches it, compiles it, caches it, and latches its fetch
status so a broken version is not re-fetched on every request. Callers supply the
Definition Type, how to compile the raw definition, and a **resolution strategy**
— `exact` pins the version asked for, `same-major` and `creation` may fall back
to older usable versions.

**Agreement Definition** — the configuration that gives an Agreement its states,
transitions, pages, values and Processes. Compiled once per grant code and
version, then cached.

**Payment Definition** — the configuration that maps source context onto the
business fields of a Payment. Owned by Payments; Agreements neither loads nor
interprets it. IDs, source identity, claim and invoice numbering, statuses and
timestamps stay code-owned and cannot be configured.

Resolved at the **exact** Config Version, never with fallback — unlike an
Agreement Definition, which falls back to older usable versions. This is
deliberate: `compileDefinition` passes the Agreement Definition's _resolved_
version to Payments, so an Agreement Definition that falls back from 1.2.0 to
1.1.0 requests its Payment Definition at 1.1.0 exactly, and the pair always
resolves at one version. Independent fallback could pair an Agreement at one
version with a Payment Definition at another and produce a Payment from
mismatched mappings.

**Mapping** — a value in a definition resolved against context at runtime:
a literal, a reference (`$.agreement.totalAmountPence`, `@.dueDate` inside a
collection), or a `jsonata:` expression. A **collection mapping**
(`{ itemsRef, items }`) resolves one item per row of the referenced array.

## Agreements

**Agreement** — the record of what a claimant has been offered and has accepted.
Immutable once constructed; a transition produces a new Agreement at the next
version rather than mutating the current one.

**Agreement Version** — the snapshot of an Agreement at one version, written
with the action execution that produced it.

**Agreement Action** — a named transition a claimant or caseworker can perform
from the Agreement's current state.

**Agreement Process** — a step configured to run at a location — creation, a
page, or a transition. An **endpoint Process** calls a configured service and
maps its response into outputs; a **handler Process** calls code registered in
Agreements and stages a Commit Operation.

**Commit Operation** — an opaque handle a Process stages for the Agreement
transaction to run. The staging module owns everything behind it; Agreements
knows only that it can be committed with the committed Agreement facts and the
session, and returns an outbox publication to write and a Claim ID to carry on
the lifecycle event. See
[docs/MODULE_BOUNDARIES.md](docs/MODULE_BOUNDARIES.md#commit-operations).

## Payments

**Payment** — an immutable record of an amount owed against an accepted
Agreement Version, split into the payments falling due over the Agreement's
term. Carries everything the Payment Service message needs, so publication never
loads the Agreement or its definition.

**Due Payment** — one instalment within a Payment: a due date, a total, and the
Invoice Lines that make it up. Its total must balance with its Invoice Lines,
and the Payment's total must balance with its Due Payments.

**Invoice Line** — one costed line within a Due Payment, carrying the accounting
codes the Payment Service requires.

**Claim ID** — the Payment Service identifier allocated from a counter inside
the committing transaction. The Agreement's lifecycle event carries it; the
Invoice Number is derived from it.

**Outbox Publication** — a message written to the shared outbox inside a
transaction, so it commits with the records it describes and is published
afterwards by the outbox subscriber. Monetary values stay numeric on domain
records and are stringified only at the legacy Payment Service message.
