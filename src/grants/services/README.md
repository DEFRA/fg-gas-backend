# Grants services

This folder contains two kinds of modules:

- Stateless helpers, such as configuration resolution, schema validation, and event-status application.
- Transactional application services that coordinate Grants repositories and domain objects for a complete operation.

`entitlement.service.js` and `claims.service.js` are the transactional application services for entitlement and claim work. They own their Mongo transactions and pass the active session to every repository operation that participates in the command. They are the only Grants entry points used by the `grant-admin` inbound adapter for this work.

Application services may import domain models to coordinate an operation. Domain models remain independent of application services, repositories, routes, and subscriptions. When an application service needs Agreement data for reference resolution, it uses the reviewed Agreements reference-context query, which returns plain data and accepts the active session.
