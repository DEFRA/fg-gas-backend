import { AUDIT_TYPE } from "../../events/event-audit.js";

// Which record an event belongs to, from the platform's own top-level fields
// on `event.data` - never from a payload, answers or snapshot below them.
// A case's refs are its application's, so every rule names the same pair.
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

// First match wins; a segregationRef is never split, as refs and codes both
// contain hyphens.
export const resolveRecordRef = (data) =>
  RULES.reduce((found, rule) => found ?? fromPair(data, rule), null) ??
  fromSource(data);

const isAuditRow = (detail) => detail.type === AUDIT_TYPE;

// An audit row is an FCP audit payload: it links to nothing.
export const recordRefOf = (detail) =>
  isAuditRow(detail) ? null : resolveRecordRef(detail.payload?.data);

export const searchRefOf = (detail) =>
  isAuditRow(detail) ? null : detail.segregationRef;
