import { toRef } from "../common/buckets/refs.js";

const hasValue = (value) => toRef("value", value) !== null;

// Refs are lower-cased, and a workflow code or case reference need not be:
// any other character than a lower-case letter, a digit or "-" is written as
// "~<hex code point>.", so two that differ only in case keep two links.
const keepCase = (value) =>
  String(value)
    .trim()
    .replace(/[^a-z0-9-]/gu, (char) => `~${char.codePointAt(0).toString(16)}.`);

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
