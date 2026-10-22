import { toRef } from "../common/buckets/refs.js";

const hasValue = (value) => toRef("value", value) !== null;

// Refs are lower-cased, and a code or a reference need not be:
// any other character than a lower-case letter, a digit or "-" is written as
// "~<hex code point>.", so two that differ only in case keep two links.
const keepCase = (value) =>
  String(value)
    .trim()
    .replace(/[^a-z0-9-]/gu, (char) => `~${char.codePointAt(0).toString(16)}.`);

const applicationKeyOf = (code, clientRef) =>
  [code, clientRef].every(hasValue)
    ? `${keepCase(code)}:${keepCase(clientRef)}`
    : null;

// An application's own events, by its reference within its grant, since two
// grants may hold the same reference; null when either is missing.
export const toApplicationLink = (code, clientRef) =>
  toRef("application", applicationKeyOf(code, clientRef));

// An application is found by its reference alone, and its own events by its link.
export const applicationRefsOf = (code, clientRef) => [
  ["ref", clientRef],
  ["application", applicationKeyOf(code, clientRef)],
];

const caseKeyOf = (workflowCode, caseRef) =>
  [workflowCode, caseRef].every(hasValue)
    ? `${keepCase(workflowCode)}:${keepCase(caseRef)}`
    : null;

// A case's own events, by its reference within its workflow, since two
// workflows may hold the same reference; null when either is missing.
export const toCaseLink = (workflowCode, caseRef) =>
  toRef("case", caseKeyOf(workflowCode, caseRef));

// A case is found by its reference alone, and its own events by its link.
export const caseRefsOf = (workflowCode, caseRef) => [
  ["ref", caseRef],
  ["case", caseKeyOf(workflowCode, caseRef)],
];

const configKeyOf = (code, version) =>
  [code, version].every(hasValue)
    ? `${keepCase(code)}@${keepCase(version)}`
    : null;

// A config version's own events, by its code and version, either of which
// may differ from another only in case; null when either is missing.
export const toConfigLink = (code, version) =>
  toRef("config", configKeyOf(code, version));

// A config version's events are found by its code alone, and listed for its
// page by its link.
export const configRefsOf = (code, version) => [
  ["ref", code],
  ["config", configKeyOf(code, version)],
];
