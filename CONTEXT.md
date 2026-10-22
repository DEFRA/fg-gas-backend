# Domain language

## Grants

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

**External Status Map**
: How a status reported by another service, such as Case Working, moves an application to a Position.

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
