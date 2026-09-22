import { config } from "../common/config.js";

// One audit predicate for the row label and the list filter, keyed on target topic.

export const AUDIT_TYPE = "audit";
export const UNKNOWN_TYPE = "unknown";

export const EVENT_TYPE_FIELDS = { inbox: "type", outbox: "event.type" };

const EVENT_NAMESPACE = /^cloud\.defra\.[^.]+\.[^.]+\./;

// Never the empty string, which the missing-type rule reads as "no type recorded".
export const shortEventType = (storedType, isAudit) =>
  storedType
    ? storedType.replace(EVENT_NAMESPACE, "") || storedType
    : labelForMissingType(isAudit);

// Only the outbox has a destination, so a type-less inbox row is always "unknown".
export const AUDIT_TARGET_FIELDS = { inbox: null, outbox: "target" };

// A getter, not captured at import: tests mock config per suite.
export const auditTopicArn = () => config?.sns?.auditTopicArn ?? null;

// Compared by topic name, not ARN: account ids differ between environments.
export const topicName = (arn) =>
  typeof arn === "string" ? arn.slice(arn.lastIndexOf(":") + 1) : null;

export const isAuditTarget = (target) => {
  const name = topicName(auditTopicArn());

  return Boolean(name) && topicName(target) === name;
};

export const labelForMissingType = (isAudit) =>
  isAudit ? AUDIT_TYPE : UNKNOWN_TYPE;

export const AUDIT_INCLUDE = "include";
export const AUDIT_EXCLUDE = "exclude";

// The exclude default lives in the query schemas; "unknown" rows are never excluded.
export const AUDIT_MODES = [AUDIT_INCLUDE, AUDIT_EXCLUDE];

const endsWithTopic = (name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`(^|:)${escaped}$`);
};

// Nothing identifiable as audit (inbox, unset topic) means nothing is filtered out.
export const auditClauses = (audit, targetField) => {
  const name = topicName(auditTopicArn());

  if (audit !== AUDIT_EXCLUDE || !targetField || !name) {
    return [];
  }

  return [{ [targetField]: { $not: endsWithTopic(name) } }];
};

// `{ $literal: false }`, not bare `false`: `$group` reads a bare boolean as a projection.
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
