import { AUDIT_TYPE } from "../../events/event-audit.js";

// Interim: EVENT-RECORDS records an event's owner at write time; delete this then.

// Only the platform's own top-level fields on `event.data`, never a payload below them.
const RULES = [
  ["clientRef", "grantCode"],
  ["clientRef", "code"],
  ["caseRef", "workflowCode"],
];

const isRef = (value) => typeof value === "string" && value !== "";

const toRef = (ref, code) => (isRef(ref) && isRef(code) ? { ref, code } : null);

const fromPair = (data, [refField, codeField]) =>
  toRef(data?.[refField], data?.[codeField]);

const fromSource = (data) => fromPair(data?.source, ["clientRef", "code"]);

// A segregationRef is never split: refs and codes both contain hyphens.
export const resolveRecordRef = (data) =>
  RULES.reduce((found, rule) => found ?? fromPair(data, rule), null) ??
  fromSource(data);

const isAuditRow = (detail) => detail.type === AUDIT_TYPE;

export const recordRefOf = (detail) =>
  isAuditRow(detail) ? null : resolveRecordRef(detail.payload?.data);

export const searchRefOf = (detail) =>
  isAuditRow(detail) ? null : detail.segregationRef;
