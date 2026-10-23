# Grants services

This folder contains three kinds of modules:

- Stateless helpers, such as configuration resolution, schema validation, and event-status application.
- Transactional application services that coordinate Grants repositories and domain objects for a complete operation.
- Read-model query services: non-transactional, they return plain data and never domain objects. They are the seam for an adapter's read paths.

`entitlement.service.js`, `claims.service.js` and `allow-list.service.js` are the transactional application-service entry points used by the `grant-admin` inbound adapter. The owning operations keep domain models behind these service boundaries and pass the active Mongo session to every repository operation that participates in a command.

Application services may import domain models to coordinate an operation. Domain models remain independent of application services, repositories, routes, and subscriptions. When an application service needs Agreement data for reference resolution, it uses the reviewed Agreements reference-context query, which returns plain data and accepts the active session.

`application-read.service.js` is the read-model query service behind `grant-admin`'s application pages: one application's facts and stored document, and its series. The Applications list is the `gas.applications` bucket, declared in `grants/buckets/`. Its repositories return read-model rows built from stored documents rather than `Application`s, so nothing the model strips is lost. It never reads inside `answers`, opens no transaction and writes nothing; the `grant-admin` use cases audit each read. A stored value of an unexpected shape, such as a legacy `submittedAt`, is returned as stored rather than refused, and is normalised by a migration, never hidden.

`config-version.service.js` is the read-model query service behind `grant-admin`'s grant version pages: a grant's Config Versions, newest first, with its Current Version; one version's Definition Files and whether each is stored; the stored grant definition; and the stored grant's lifecycle, as `Grant#describeLifecycle` resolves it, or why the stored grant cannot give one. It reads the rows as stored and builds `ConfigVersionFiles`, which refuses a malformed row rather than filling a default, so a bad row is fixed by a migration, never hidden. It never fetches from S3 and writes nothing.
