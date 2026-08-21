# Module Boundaries

## Bounded Contexts

| Module       | Path              | Description                                                       |
| ------------ | ----------------- | ----------------------------------------------------------------- |
| `grants`     | `src/grants/`     | Grants and Application sub-domain (grant lifecycle, applications) |
| `agreements` | `src/agreements/` | Agreements domain (separate bounded context)                      |
| `payments`   | `src/payments/`   | Payments domain (Payments, claim IDs, invoice numbering)          |
| `auth`       | `src/auth/`       | Authentication and authorisation                                  |
| `common`     | `src/common/`     | Shared infrastructure (logger, database, messaging clients)       |

## Forbidden Imports

`agreements`, `grants` and `payments` must not directly import each other's internals (models, repositories, use-cases, services, routes, schemas, etc.). The boundary is enforced in both directions. Direct cross-module imports create hidden coupling that prevents either context from evolving independently.

`payments` knows nothing about the modules that source a Payment: it never imports `agreements` or `grants`, and it takes the identifiers it needs as plain values.

This is enforced by the `import-x/no-restricted-paths` rule in `eslint.config.js` and runs on every local commit (via lint-staged) and in CI (`npm run lint`).

## Allowed Integration Seams

When Agreements needs to collaborate with Grants, use one of these approved seams:

| Seam                       | How                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| **HTTP / REST API**        | Call the Grants HTTP endpoints; do not share route handlers or controllers                  |
| **Events**                 | Publish to or consume from SNS/SQS topics; event shapes live in `src/*/events/`             |
| **Commands**               | Send commands via the message bus; command shapes live in `src/*/commands/`                 |
| **Inbox / Outbox records** | Write to the shared inbox/outbox collection; poll or subscribe to the other module's outbox |
| **Shared infrastructure**  | Import from `src/common/` (logger, DB client, messaging helpers)                            |

### Direct entry points

Some collaborations cannot use an event, command or HTTP seam. Only the named Payments use cases below may be imported:

| Caller       | Entry point                                                | Why                                                                                                               |
| ------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `agreements` | `payments/use-cases/prepare-agreement-payment.use-case.js` | Payments prepares the commit operation from Agreement action context before the transaction starts                |
| `agreements` | `payments/use-cases/create-agreement-payment.use-case.js`  | The Payment for an accepted Agreement Version must commit with the Agreement, its Version and the lifecycle event |

The transactional entry point takes the caller's session. The ESLint zone lists both exceptions explicitly so adding another one is a deliberate, reviewed change.

`payments` owns the shape of the Payment Service message (`payments/events/create-payment.event.js`) and returns it from that entry point as an outbox publication. The caller writes it to the outbox inside its own transaction, so the message commits with the Agreement while `payments` stays out of the outbox and out of publishing.

## Adding a New Seam

1. Define the event or command shape in the publishing module's `events/` or `commands/` directory.
2. The consuming module subscribes or polls — it does not import the publisher's internals.
3. If a new category of seam is introduced, update this document and the ESLint rule accordingly.
