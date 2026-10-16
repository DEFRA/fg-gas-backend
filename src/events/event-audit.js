import { config } from "../common/config.js";

// One audit predicate for the row label and the stamp backfill, keyed on target topic.

export const AUDIT_TYPE = "audit";
export const UNKNOWN_TYPE = "unknown";

const EVENT_NAMESPACE = /^cloud\.defra\.[^.]+\.[^.]+\./;

// Never the empty string, which the missing-type rule reads as "no type recorded".
export const shortEventType = (storedType, isAudit) =>
  storedType
    ? storedType.replace(EVENT_NAMESPACE, "") || storedType
    : labelForMissingType(isAudit);

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
