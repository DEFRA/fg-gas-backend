# Grants services

This folder contains three kinds of modules:

- Stateless helpers, such as configuration resolution, schema validation, and event-status application.
- Transactional application services that coordinate Grants repositories and domain objects for a complete operation.
- Read-model query services: non-transactional, they return plain data and never domain objects. They are the seam for an adapter's read paths.

`entitlement.service.js` and `claims.service.js` are the transactional application services for entitlement and claim work. They own their Mongo transactions and pass the active session to every repository operation that participates in the command. They are the only Grants entry points used by the `grant-admin` inbound adapter for this work.

Application services may import domain models to coordinate an operation. Domain models remain independent of application services, repositories, routes, and subscriptions. When an application service needs Agreement data for reference resolution, it uses the reviewed Agreements reference-context query, which returns plain data and accepts the active session.

`application-read.service.js` is the read-model query service behind `grant-admin`'s application pages: the Applications list, one application's facts and stored document, its series, and the grant codes. Its repositories return read-model rows built from stored documents rather than `Application`s, so nothing the model strips is lost. It never reads inside `answers`, opens no transaction and writes nothing; the `grant-admin` use cases audit each read. A stored value of an unexpected shape, such as a legacy `submittedAt`, is returned as stored rather than refused, and is normalised by a migration, never hidden.
