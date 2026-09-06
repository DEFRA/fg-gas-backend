# Module Boundaries

## Bounded Contexts

| Module        | Path               | Description                                                       |
| ------------- | ------------------ | ----------------------------------------------------------------- |
| `grants`      | `src/grants/`      | Grants and Application sub-domain (grant lifecycle, applications) |
| `agreements`  | `src/agreements/`  | Agreements domain (separate bounded context)                      |
| `payments`    | `src/payments/`    | Payments domain (Payments, claim IDs, invoice numbering)          |
| `grant-admin` | `src/grant-admin/` | Inbound admin adapter for Entitlement and Claim operations        |
| `auth`        | `src/auth/`        | Authentication and authorisation                                  |
| `common`      | `src/common/`      | Shared infrastructure (logger, database, messaging clients)       |

## Forbidden Imports

`agreements`, `grants` and `payments` must not directly import each other's internals (models, repositories, use-cases, services, routes, schemas, etc.). The boundary is enforced in both directions, except for explicitly documented reviewed seams below. Direct cross-module imports create hidden coupling that prevents either context from evolving independently.

`grant-admin` is an inbound adapter, not a peer domain module. It validates and maps HTTP/UI concerns but does not access Grants models, repositories, schemas, use cases, or general services. Its only Grants entry points for entitlement and claim work are `grants/services/entitlement.service.js` and `grants/services/claims.service.js`. `grants` never imports from `grant-admin`, and `grant-admin` does not import from `agreements`.

`payments` knows nothing about the modules that source a Payment: it never imports `agreements` or `grants`, and it takes the identifiers it needs as plain values.

This is enforced by the `import-x/no-restricted-paths` rule in `eslint.config.js` and runs on every local commit (via lint-staged) and in CI (`npm run lint`).

## Allowed Integration Seams

When Agreements needs to collaborate with Grants, use one of these approved seams:

| Seam                                      | How                                                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **HTTP / REST API**                       | Call the Grants HTTP endpoints; do not share route handlers or controllers                                                                                                                                   |
| **Events**                                | Publish to or consume from SNS/SQS topics; event shapes live in `src/*/events/`                                                                                                                              |
| **Commands**                              | Send commands via the message bus; command shapes live in `src/*/commands/`                                                                                                                                  |
| **Inbox / Outbox records**                | Write to the shared inbox/outbox collection; poll or subscribe to the other module's outbox                                                                                                                  |
| **Shared infrastructure**                 | Import from `src/common/` (logger, DB client, messaging helpers)                                                                                                                                             |
| **Grants → Agreements reference context** | `grants` may call the reviewed Agreements query interface for a plain reference-resolution context. The query accepts the active Mongo session; it does not expose an Agreements repository or domain model. |

### Grant Admin entry points

Grant Admin enters the Grants application layer through two named services:

| Caller        | Entry point                              | Responsibility                                    |
| ------------- | ---------------------------------------- | ------------------------------------------------- |
| `grant-admin` | `grants/services/entitlement.service.js` | Entitlement overview and creation operations      |
| `grant-admin` | `grants/services/claims.service.js`      | Claimable-entitlement lookup and Claim submission |

These services return plain DTOs at the adapter boundary. Grant Admin may compose those DTOs into its banner and view models, but it must not receive or return Grants domain objects.

### Payment entry points

Agreement acceptance uses two named Payment use cases:

| Caller       | Entry point                                               | Why                                                                                                                                                       |
| ------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agreements` | `payments/use-cases/resolve-payment-definition.js`        | Resolves and validates the persisted Agreement's exact Payment definition before the transaction starts, so configuration or fetch failures write nothing |
| `agreements` | `payments/use-cases/create-agreement-payment.use-case.js` | Creates the Payment in the Agreement action's Mongo session so the Payment, Agreement, Version and lifecycle event commit together                        |

The resolver is a read-only, pre-transaction seam. Config Broker loading and mapping validation stay outside the write transaction. The creation use case is the transactional seam, and the caller passes its session in.

A Payment definition supplies `originalInvoiceNumber` as a top-level lookup or literal mapping. It also supplies `deliveryBody` and `marketingYear` at both Payment and invoice-line levels. Invoice-line values may differ from the Payment-level values, and `payments` preserves them when it builds the Payment. `payments` generates `invoiceNumber`.

Nothing else in `payments` is importable from Agreements. The ESLint zone lists both exceptions explicitly so adding another one is a deliberate, reviewed change.

`payments` owns the shape of the Payment Service message (`payments/events/create-payment.event.js`) and returns it from the creation entry point as an outbox publication. The caller writes it to the outbox inside its own transaction, so the message commits with the Agreement while `payments` stays out of the outbox and out of publishing.

## Adding a New Seam

1. Define the event or command shape in the publishing module's `events/` or `commands/` directory.
2. The consuming module subscribes or polls — it does not import the publisher's internals.
3. If a new category of seam is introduced, update this document and the ESLint rule accordingly.
