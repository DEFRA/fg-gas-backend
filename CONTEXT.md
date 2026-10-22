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

## Config versions

**Config Version**
: One published version of a grant's configuration, as the Config Broker announced it. It is Active or Draft. The admin portal calls it a grant version.

**Definition File**
: One part of a Config Version that a context reads: the grant's own definition, and optionally an agreement definition and a payment definition.

**Stored Definition**
: A Definition File that GAS holds itself. Until it is stored, the Config Version is only an announcement.

**Current Version**
: The Config Version GAS gives new applications: the newest Active one.

**Fetch Definitions**
: An operator asks GAS to store every Definition File of a Config Version that is not stored. It never changes what GAS recorded about fetching the version. For a Workflow Version, GAS asks Caseworking, which stores it.
_Avoid_: refresh, cache.

**Workflow Version**
: Caseworking's half of a Config Version: the workflow it holds under the same code and version. GAS holds none; Grant Admin reads it from Caseworking.
