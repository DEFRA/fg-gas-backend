import { config } from "../common/config.js";

// What makes a row an audit record, said once, in both languages the admin
// events surface speaks: JavaScript (the mapper labels the row) and Mongo
// (the list filter selects it). Keeping label and filter on one predicate is
// the point of this module - the row the API calls "audit" and the row a
// default page leaves out must be the same row, or an operator's counts stop
// matching their rows.
//
// Identified POSITIVELY, by where the row was addressed (`write-audit-event.js`
// is the only writer targeting `config.sns.auditTopicArn`). The absence of a
// CloudEvent type is a CONSEQUENCE of being an audit record, not the
// definition: other type-less rows exist, and calling them audit would
// mislabel them and hide them from the operator who most needs to see them.
//
//   stores a type            -> that type
//   no type, audit target    -> "audit"    (excluded by default)
//   no type, anything else   -> "unknown"  (always visible - it is an anomaly)

export const AUDIT_TYPE = "audit";
export const UNKNOWN_TYPE = "unknown";

export const AUDIT_FULL_TYPE = "Audit record — not a CloudEvent";
export const UNKNOWN_FULL_TYPE = "No event type recorded — not a CloudEvent";

// Used by the breakdown's `$group`, so it groups on exactly the field the
// mapper reads.
export const EVENT_TYPE_FIELDS = { inbox: "type", outbox: "event.type" };

// Only the outbox has a destination, so an inbox row can never be an audit
// record: a type-less inbox row (models/inbox.js does not validate `type`) is
// always "unknown".
export const AUDIT_TARGET_FIELDS = { inbox: null, outbox: "target" };

// Read through a getter, never captured at import time: `config` is built from
// the environment and the tests that mock it do so per suite. Optional
// chaining because a partially mocked config is a normal thing in this repo.
export const auditTopicArn = () => config?.sns?.auditTopicArn ?? null;

// The topic NAME (after the last colon) is the identity, never the whole ARN:
// account ids differ between environments and a database outlives the account
// that wrote into it, so whole-ARN comparison recognises only whichever
// account is currently configured and mislabels the rest "unknown".
export const topicName = (arn) =>
  typeof arn === "string" ? arn.slice(arn.lastIndexOf(":") + 1) : null;

export const isAuditTarget = (target) => {
  const name = topicName(auditTopicArn());

  return Boolean(name) && topicName(target) === name;
};

// Takes the RESOLVED fact rather than a target: the mapper asks
// `isAuditTarget`, while the breakdown merge has an `audit` flag Mongo
// computed in the `$group` key. One function, one rule, so a group and the
// rows it counts can never read differently.
export const labelForMissingType = (isAudit) =>
  isAudit ? AUDIT_TYPE : UNKNOWN_TYPE;

export const fullTypeForMissingType = (isAudit) =>
  isAudit ? AUDIT_FULL_TYPE : UNKNOWN_FULL_TYPE;

export const AUDIT_INCLUDE = "include";
export const AUDIT_EXCLUDE = "exclude";

// The exclude-by-default DEFAULT lives in the query schemas, not here: an
// HTTP contract states its own defaults, and every internal caller then has
// to say what it means (the journey asks for `include` - a hop missing from a
// message's history is a hole in the answer, not noise removed from it).
// "unknown" rows are never excluded: they are anomalies an operator should see.
export const AUDIT_MODES = [AUDIT_INCLUDE, AUDIT_EXCLUDE];

// Anchored where an ARN puts the name - after the last colon - with regex
// metacharacters escaped, so no other topic can end in it by accident.
const endsWithTopic = (name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`(^|:)${escaped}$`);
};

// The Mongo half, the exact query-level expression of `isAuditTarget`. Narrow
// on purpose: it removes only rows addressed at the audit topic, so a
// type-less non-audit row survives it. No clause for the inbox (no target
// field) and none when the audit topic is unconfigured - in both cases
// nothing is identifiable as an audit record, so nothing may be removed.
// GAS's own boxes only, because only this service can recognise its OWN audit
// topic. Caseworking answers the same question about its own rows: `audit` is
// forwarded to its actuators and applied there - see
// grant-admin/repositories/cw-actuators.repository.js. It was withheld while
// those actuators did not know the parameter, and this comment outlived that.
export const auditClauses = (audit, targetField) => {
  const name = topicName(auditTopicArn());

  if (audit !== AUDIT_EXCLUDE || !targetField || !name) {
    return [];
  }

  return [{ [targetField]: { $not: endsWithTopic(name) } }];
};

// The `$group` key's audit flag: audit and unknown groups both group under a
// null type and must not be merged into one. The constant is
// `{ $literal: false }`, never a bare `false` - `$group` reads a bare boolean
// as an inclusion-style projection and refuses the whole pipeline.
export const auditGroupExpression = (targetField) => {
  const name = topicName(auditTopicArn());

  return targetField && name
    ? {
        $eq: [
          {
            $arrayElemAt: [{ $split: [`$${targetField}`, ":"] }, -1],
          },
          name,
        ],
      }
    : { $literal: false };
};
