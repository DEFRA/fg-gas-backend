# Domain language

## Grants

**Grant Action**
: A named outside call a grant declares, which grants-ui asks GAS to make.

**Grant Allow List**
: The set of applicant identifiers permitted to apply for one configured grant.

**Global Allow List**
: The CRNs and SBIs permitted across the whole grant.

**Replace Global Allow List**
: Replace the grant's CRN and SBI collections together. Replacement never appends or merges.

**Unrestricted Grant**
: A grant whose Global Allow List contains no CRNs or SBIs, allowing anyone to apply.

**Grant Definition**
: The published `gas.json` for one config version of a grant. A config version is only recorded once its Grant Definition builds a usable Grant.

**Position**
: Where an application sits in a grant's lifecycle, written `PHASE:STAGE:STATUS`. Every position a Grant Definition refers to must be one of its own.

**Grant Lifecycle**
: The phases, stages and statuses of a Grant Definition, and which positions each status can be entered from.

**Way In**
: How an application reaches a Position: a Move, a validFrom entry no Position matches, or from any status when the status has no validFrom.

**Move**
: A validFrom entry resolved to the Position it admits, as a transition checks it. Each source moves by the first entry it matches, and runs that entry's processes.

**External Status Map**
: How a status reported by another service, such as Case Working, moves an application to a Position.

**External Status Mapping**
: One entry of the External Status Map: a source's status code, the phase and stage it applies while in, and where it moves the application, when a Move to there allows it. Only the first entry for a source and code in a stage is applied.

**Claim Approval Transition**
: The move GAS makes itself, from one Position to another, when a claim submitted at that Position leaves no claim to make, unless the claim requires approval. GAS publishes the move to Case Working.

## Applications

**Client Reference**
: The reference an applicant's service gives an application. It is unique only within its grant, so an application is identified by its grant code and Client Reference together.

**Application Series**
: The applications of one grant linked by a previous Client Reference: an application and those it replaced.

## Events

**Event Reference**
: An identifier an event is searched by: its Client Reference, trace ID or event ID.

**Event Link**
: A record's own key on an event, such as an application within its grant or a case within its workflow. Its writer sets it from the record it holds, and the record's Events tab reads by it. It is never offered as a search.

## Config versions

**Config Version**
: One published version of a grant's configuration, as the Config Broker announced it. It is Active or Draft. The admin portal calls it a grant version.

**Definition File**
: One part of a Config Version that a context reads: the grant's own definition, and optionally an agreement definition and a payment definition.

**Stored Definition**
: A Definition File that GAS holds itself. Until it is stored, the Config Version is only an announcement.

**Current Version**
: The Config Version GAS gives new applications: the newest Active one.

## Mappings

**Mapping**
: A value in a definition that is resolved against a context. It is a literal, a `$.` reference to the context, an `@.` reference to the current row, a `jsonata:` expression, an `itemsRef`/`items` collection that repeats `items` for each row of a list, or an array or object whose values are themselves Mappings.

## Payments

**Payment Definition**
: How a grant version turns a trigger's context into a Payment request: its request fields and its Due Payments, each given as a Mapping.

**Due Payment**
: One dated part of a Payment, with a total and its Invoice Lines.

**Invoice Line**
: One accounting line of a Due Payment.

## Agreements

**Service Address**
: The configured base's scheme, host and path, plus the path of an agreement endpoint, a Process's or a root one. It never includes the service's headers, credentials, query or fragment.
_Avoid_: service URL, when the configured value is meant.

**Page Processes**
: The Processes an agreement State runs every time one of its pages is rendered. They do not run once on entry.
_Avoid_: on entry.
