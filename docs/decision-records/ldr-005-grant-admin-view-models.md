# Lightweight Decision Record - Grant Admin View Models

|                  |                            |
| ---------------- | -------------------------- |
| status           | accepted                   |
| date             | 13 Oct 2026                |
| decision makers  | Grants Platform Admin team |
| people consulted | Core Grants Team           |
| people informed  | Core Grants Team           |

## Context and Problem Statement

`fg-grants-platform-admin` (GPA) is a server-rendered admin UI. `grant-admin` is GAS's
inbound adapter for it - already documented as "a backend for frontend by design" (see
[Grant Admin entry points](../MODULE_BOUNDARIES.md#grant-admin-entry-points)). For the
allow-list screen (FGP-1507), GPA was doing the screen-shaping itself: splitting
submitted textarea lines, mapping GAS's validation result back onto specific lines,
and building GOV.UK field objects (label/value/hint/error) - all in
`allow-list-form.view-model.ts`.

This duplicated a pattern that had already gone wrong once: `resolveClaimsAccess` (the
full/view-only/hidden role decision) was implemented identically in both GAS's
`grant-admin/services/claims-access.js` and GPA's `grant-ops/view-models/claims-access.ts`,
because GAS computed the decision for its own authorization gate but never returned it,
leaving GPA to re-derive it to decide button visibility. We want GAS's grant-admin
surface to model everything a GPA screen needs, so GPA contains no decisions about
GAS's domain data - only rendering and genuinely client-side behaviour.

We need a place for that screen-shaping to live in GAS that cannot quietly grow a
dependency on a repository or a domain service, because that is exactly how the claims
duplication happened: ordinary-looking view-shaping code in a shared layer, free to
import anything.

## Decision Drivers

- Domain decisions (validation, access) stay in `grants`; nothing in GPA.
- GPA should be left with only true frontend code: HTTP routing, session/flash
  handling, template rendering, and browser JavaScript.
- The guarantee must be structural (lint-enforced), not a naming convention - the
  claims duplication happened inside a convention, not despite a missing one.
- The change should be scoped to one screen, not force an immediate rewrite of the
  existing `grant-admin/services/*` view-shaping code (`build-claims-view.js` and
  friends).

## Considered Options

### 1. Leave the view-shaping in GPA

Keep `allow-list-form.view-model.ts` where it is.

Good, because it requires no change to GAS at all.

Bad, because it is the thing we are trying to stop: GPA ends up encoding GAS's
domain knowledge (SBI is 9 digits, CRN is 10) in its own presentation code, and the
tech lead's concern - domain logic leaking into GPA - would simply not be addressed.

### 2. Add the view-shaping to GAS's existing `grant-admin/services/`

Mirror `build-claims-view.js` exactly: add `build-allow-list-view.js` next to it.

Good, because it is zero new lint surface and matches the house style exactly.

Bad, because `services/` is a flat catch-all already holding code that is not a pure
transform (`claims-access.js` reads request headers and throws Boom). Nothing stops a
`services/` file from importing a repository directly - the separation between "shapes
a view" and "does something else" is a convention, not a rule, which is exactly how the
claims duplication happened.

### 3. Add a lint-enforced `grant-admin/view-models/` zone

Add a new `import-x/no-restricted-paths` zone: a file under `view-models/` may import
only another file under `view-models/` - nothing from `common/`, `repositories/`,
`use-cases/`, `services/`, or a domain module. Routes call both layers directly, the
same way `get-claims.route.js` already calls a domain service and
`services/build-claims-view.js` side by side.

Good, because the guarantee is mechanical: a view-model genuinely cannot reach a
repository or a domain service, even by accident, which is the thing option 2 cannot
promise.

Good, because it can be introduced for one screen (`build-allow-list-view.js`) without
touching `build-claims-view.js` or anything else already in `services/`.

Bad, because it adds a second screen-shaping location in `grant-admin` (`services/` and
`view-models/`) until the rest of the module is migrated, which is not part of this
change.

### 4. Move the view-shaping into a standalone BFF service

Introduce a third service between GPA and GAS, separate from GAS's own deploy.

Good, because it would keep GAS's own API fully UI-agnostic for any future consumer.

Bad, because GPA is GAS's only `grant-admin` consumer today; a new service, repo and
deploy pipeline is not justified yet. Revisit if that changes.

## Decision Outcome

Option 3 - a new, lint-enforced `grant-admin/view-models/` zone, introduced for the
allow-list screen only.

`src/grant-admin/view-models/build-allow-list-view.js` now owns everything the
allow-list screen needs: parsing submitted text into lines (preserving blank-line
positions, since error messages anchor to the line the user actually typed on),
mapping the domain's `{ invalid, duplicate }` result back onto those lines, and
building the GOV.UK field shape (label/value/hint/error) and error summary. The two
routes (`get-allow-list.route.js`, `replace-allow-list.route.js`) call it exactly the
way `get-claims.route.js` calls `build-claims-view.js`: resolve data through
`grants/services/allow-list.service.js`, then pass it to the view-model to shape the
response. `grant-admin/schemas/allow-list-view.schema.js` is the response contract
that shape is validated against.

GPA's `allow-list-form.view-model.ts` was deleted. GPA's route
(`grant-ops/routes/allow-list.route.ts`) now does only HTTP routing, session/flash
handling (the redirect-after-POST pattern, the saved-banner flash, which tab is
active) and 403/404 status mapping - it renders whatever view GAS returns directly.

`build-claims-view.js` and the rest of `grant-admin/services/` are unchanged. Moving
them onto the same `view-models/` rule is explicitly out of scope here; it is future
work once there is a second screen to prove the pattern against.

## Consequences

A new `import-x/no-restricted-paths` zone target (`**/view-models/**`) is enforced in
CI and on every local commit, the same as the existing `grant-admin → grants` seam
restriction. A `view-models/` file that tries to import a repository, a use case, a
domain service, or even `common/`, fails lint rather than merging quietly.

`grant-admin` temporarily has two screen-shaping locations (`services/` for claims,
events, cases and applications; `view-models/` for allow-list) until the rest of the
module adopts the same convention. This is accepted as the cost of proving the rule
on one screen before committing the whole module to it.

GAS's `replace-allow-list` request contract changed from pre-split arrays
(`{ global: { sbi: string[], crn: string[] } }`) to raw submitted text
(`{ sbi: string, crn: string }`), so the view-model can parse it and produce
blank-line-accurate error positions itself. This is a breaking change to that one
endpoint's request shape, coordinated with GPA's PR directly rather than versioned,
since both were pre-release at the time.

## More Information

Delivery ticket: FGP-1507 (grant allow-list administration).
Related: [Grant Admin entry points](../MODULE_BOUNDARIES.md#grant-admin-entry-points),
[View models vs. services](../MODULE_BOUNDARIES.md#view-models-vs-services).
