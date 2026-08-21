# fg-gas-backend

Grant Application Service defines and manages farming grants and applications. It is the source of truth for all grant applications and their status.

- [Running with other services](#running-with-other-services)
- [User guide](#user-guide)
  - [Configure grant actions](#configure-grant-actions)
- [Developer guide](#developer-guide)
  - [Node.js](#nodejs)
- [Local development](#local-development)
  - [Setup](#setup)
  - [AWS emulation (floci)](#aws-emulation-floci)
  - [Development](#development)
  - [Testing](#testing)
    - [Unit tests](#unit-tests)
    - [Integration tests](#integration-tests)
    - [Contract tests](#contract-tests)
- [Service to service authentication](#service-to-service-authentication)
  - [Minting service access tokens](#minting-service-access-tokens)
- [HTTP client and API examples](#http-client-and-api-examples)
- [Docker](#docker)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Running with other services

If you want to run this service with other farming grants applications see [fg-grants-core](https://github.com/DEFRA/fg-grants-core)

## User guide

### Configure grant actions

As part of the Grant Application Service, you can configure and call actions on grants.

Given a grant definition is stored in GAS as per the following example:

- Note the $areaId and $segmentId in the URL, these are placeholders that will be replaced with actual values when the action is invoked.

```json
{
  "code": "my-grant-code",
  "actions": [
    {
      "name": "land-area-calculation",
      "method": "POST",
      "url": "https://my-other-server.%ENVIRONMENT%.gov.uk/some-path/area-calc/$areaId/$segmentId"
    }
  ]
}
```

Note: The `%ENVIRONMENT%` placeholder will be replaced with the current CDP environment when running in a CDP environment.

This can be called via the following HTTP request:

- Note the areaId and segmentId query parameters, these will be used to replace the placeholders in the URL.
- The anotherParam query parameter is an example of additional parameters will be passed on in the URL query string.

```http request
POST http://gas-server/grants/my-grant-code/actions/land-area-calculation/invoke?areaId=123&segmentId=456&anotherParam=ABC123
Content-Type: application/json

{
  "someKey": "someValue"
}
```

This wil result in the following HTTP request being made to the configured URL:

```http request
POST https://my-other-server/some-path/area-calc/123/456?code=my-grant-code&anotherParam=ABC123
Content-Type: application/json

{
  "someKey": "someValue"
}
```

## Developer guide

### Node.js

Please install Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
cd fg-gas-backend
nvm use
```

## Local development

### Setup

Install application dependencies:

```bash
npm install
```

Create a `.env` file in the root of the project. You can use the `.env.example` file as a template.

```bash
cp .env.example .env
```

`VIEW_AGREEMENT_URI` is the Agreements UI base used in accepted Agreement
lifecycle events. Do not include a trailing slash; the Agreement Number is
appended when the event is created.

`AGREEMENTS_JWT_SECRET` (FGP-1307) is the shared HS256 secret GAS uses to verify
the caller token (the `x-encrypted-auth` header) forwarded by Agreements UI on
the agreement routes. It must match the secret the producer services sign with
(Caseworking frontend, PDF service and Grants UI). It is supplied per
environment from the platform secret store and must never be committed. It is
optional while verification runs in warn-only mode; when absent the caller token
is reported as unverified but requests are not rejected. `CALLER_TOKEN_ALLOWED_ISSUERS`
is the comma-separated list of producer issuers permitted to mint caller tokens
(defaults to `grants-ui,fg-cw-frontend,agreements-pdf`).

### AWS emulation (floci)

SQS and SNS are emulated by [floci](https://floci.io) on `localhost:4566`,
replacing LocalStack. The rest of the stack (`fg-grants-core`, `fg-cw-backend`)
uses the same emulator.

Queues, topics and subscriptions are created by init scripts mounted into the
`floci` container. They run in lexical order **by filename**, pooled across every
repo that mounts one in:

| Script                  | Mounted by                                 |
| ----------------------- | ------------------------------------------ |
| `10-setup-resources.sh` | this repo (`compose/floci/start.d/`)       |
| `99-ready.sh`           | this repo — writes the `/tmp/READY` marker |

The container's healthcheck waits on `/tmp/READY` rather than on the gateway
responding, because floci starts serving HTTP before the init scripts have
finished. Services that `depends_on` floci with `condition: service_healthy`
therefore never start before their queues exist. If you add a script, give it a
numeric prefix below `99`.

When gas is pulled into another stack that already runs floci, only
`10-setup-resources.sh` is mounted and the host stack owns the marker — see
`compose/ext/compose.gas-ext.example.yml`.

State is in-memory: every `compose up` recreates the resources from scratch.

#### Inspecting queues and topics

The compat image ships the AWS CLI, so the quickest route needs nothing
installed on the host:

```bash
docker compose exec floci awslocal sqs list-queues
docker compose exec floci awslocal sns list-topics
docker compose exec floci awslocal sqs receive-message \
  --queue-url $(docker compose exec -T floci awslocal sqs get-queue-url \
    --queue-name gas__sqs__update_status_fifo.fifo --output text)
```

Note that queues dead-letter after a single failed receive by default, so
peeking at a queue can consume the message. Set `MAX_READS=2` in
`compose/aws.env` and recreate the stack if you need headroom.

### Development

To run the application in `development` mode run:

```bash
npm run dev
```

### Testing

#### Unit tests

To run the unit tests:

```bash
npm run test:unit
```

#### Integration tests

To run the integration tests:

```bash
npm run test:integration
```

#### Contract tests

This project uses Pact to verify consumer-provider contracts.

- To run the contract tests against the Pact broker:

```bash
npm run test:contract
```

Note: This is normally used in CI, but if running locally it requires `.env.test` to be populated with the broker details and you must be connected to the Azure VPN.

- To run the contract tests locally against local pact files (helpful when developing without Azure VPN access or iterating quickly), use the provided script which sets `PACT_USE_LOCAL=true`:

```bash
npm run test:contract:local
```

When `PACT_USE_LOCAL=true`, tests will read pact files from `tmp/pacts` (for example `tmp/pacts/grants-ui-fg-gas-backend.json`).

## Service to service authentication

The GAS API uses simple bearer tokens for service access. Tokens are UUIDv4 values whose SHA‑256 hash is stored in MongoDB in the `access_tokens` collection.

Clients must send the raw token in the `Authorization` header as `Bearer <token>`.

### Minting service access tokens

There is a helper script to mint access tokens and optionally write them to MongoDB:

Use `scripts/mint-access-token.js` to mint a token and, if `MONGO_URI` and `MONGO_DATABASE` are set, write the hashed token to Mongo.

Usage:

```bash
# Mint and write hashed token to Mongo, print raw token to console
node --env-file=.env scripts/mint-access-token.js [clientName] [expiresISO]
```

```bash
# Mint and print hashed token and raw token to console
node scripts/mint-access-token.js [clientName] [expiresISO]
```

- `clientName` defaults to `grants-ui`.
- `expiresISO` is optional (e.g. `2099-01-01T00:00:00Z`).

The script prints:

- A confirmation message and details.
- The hashed token if `MONGO_URI` and `MONGO_DATABASE` are not set.
- The raw bearer token on the last line – copy and store it securely. It will not be shown again.

There is also a convenience script to mint and write the raw token to `http-client.private.env.json` to allow for local testing with `api.http`:

```bash
npm run token:local
```

This runs: `node --env-file=.env scripts/write-http-client-token.js local http-client 2099-01-01T00:00:00Z`.

Which uses `scripts/write-http-client-token.js` to mint a token, store in the local MongoDB and write the raw value into `http-client.private.env.json` under the chosen environment key, so `api.http` can use it immediately.

### Run with manual vars:

`MONGO_URI="mongodb://localhost:27017" MONGO_DATABASE=fg-gas-backend node scripts/mint-access-token.js`

### Minting access tokens for fg-grants-core

When using grants core with just the case working and gas dev mode the mongo db is available on localhost and does not use a direct connection.

If you're using grants core with external apps (grants-ui for example) then the db connection is through the docker network and direct connection is
required. The env-file option won't work here. You have to manually add MONGO_URI and MONGO_DATABASE to the command - see "run with manual vars"

General script usage for any environment if needed:

```bash
node --env-file=.env scripts/write-http-client-token.js <envName> [clientName] [expiresISO]
```

Examples:

```bash
# Local environment – also inserts the hash into Mongo (requires MONGO_URI/MONGO_DATABASE)
node --env-file=.env scripts/write-http-client-token.js local http-client 2099-01-01T00:00:00Z
```

```bash
# Non-local environment – only updates http-client.private.env.json
node scripts/write-http-client-token.js dev grants-ui 2026-01-01T00:00:00Z
```

After running, you should see output similar to:

```
Updated http-client.private.env.json -> [local].serviceToken
```

Notes and requirements:

- For local usage, ensure your `.env` provides `MONGO_URI` and `MONGO_DATABASE` so the hashed token can be stored in MongoDB.
- `http-client.private.env.json` is git‑ignored by default. Keep tokens out of source control.

## HTTP client and API examples

This repository includes `api.http` which you can run directly from JetBrains IDEs (HTTP Client) or VS Code (REST Client extension).

- Base URLs are defined in `http-client.env.json` (checked in).
- Private secrets (like the `serviceToken`) are stored in `http-client.private.env.json` (git‑ignored). Do not commit this file.

`api.http` uses these variables:

- `{{base}}` – selected environment base URL (for example `http://localhost:3000`).
- `{{serviceToken}}` – a bearer token used by the API for service‑to‑service auth.

To run the requests:

1. Ensure the API is running locally (see Development section), or pick a non‑local environment.
2. Make sure `http-client.private.env.json` has a `serviceToken` for the environment you want to call. You can generate/populate this token using the scripts above.
3. Open `api.http`, select the desired environment from the drop‑down (e.g. `local`) and send requests.

## Docker

Launch GAS and dependencies via Docker Compose:

```bash
docker compose up --watch
```

## Project structure

Routes can access use cases and schemas.
Subscriptions can access use cases.
Use cases can access repositories, http clients, domain classes and other use cases.
Use cases should export a single function.
Repositories can access db.

Routes and subscriptions should never respond with a domain object.
Domain objects should never access use cases, repositories or subscriptions.
Repositories should never accept or return db records.

## Logging

This application uses [Pino](https://getpino.io/) for structured logging, configured with ECS (Elastic Common Schema) formatting for better observability and log analysis.

Logging is configured in `src/common/logger.js`.

### Basic Logging

We use entry and exit level logging patterns for better log correlation.

**Entry logs** indicate the start of an operation:

**Exit logs** indicate the completion of an operation:

> **Note**: We use consistent entry text to make it easier to correlate logs within OpenSearch.

### Conditional Logging

For operations that have conditional logic between entry and exit logs, use `logger.debug()` or `logger.info()` based on relevance:

**Example implementation**: See `src/grants/use-cases/add-agreement.use-case.js`

### Log Levels

**Warning logs** for recoverable issues:

**Debug logs** for detailed diagnostic information:

> **Note**: Error logging (`logger.error`) is typically not required in use cases as errors are thrown and will propagate up the call stack where they can be handled and logged by the error handling middleware.

### Best Practices

- Use structured logging with context objects for better searchability
- Include relevant identifiers (IDs, codes, references) in log messages
- Keep entry and exit log messages consistent for easier correlation
- Use appropriate log levels based on the importance of the information

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
