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
