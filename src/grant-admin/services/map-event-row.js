import {
  isAuditTarget,
  labelForMissingType,
} from "../../events/event-audit.js";
import { normaliseAttemptHistory } from "../../events/last-error.js";
import {
  actorName,
  attemptsLabel,
  latency,
  latencyTitle,
  statusDisplay,
} from "./event-display.js";

const NAMESPACE = /^cloud\.defra\.[^.]+\.[^.]+\./;
const INTERNAL_BUS = "internal:message-bus";
const INTERNAL_BUS_NAME = "internal";
const HEX = 16;
// OpenSearch indexes only the trace-id half; a non-W3C value already is one.
const W3C_TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-/i;
const ID_TIMESTAMP_CHARS = 8;
const MS_PER_SECOND = 1000;
const DEFAULT_ERROR_NAME = "Error";

const isMissing = (value) => value === null || value === undefined;

export const orNull = (value) => (isMissing(value) ? null : value);

export const toIso = (value) => {
  const date = isMissing(value) ? null : new Date(value);

  return date === null || Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
};

// Left as stored unless a Date, so the keyset boundary never moves.
const toIsoIfDate = (value) =>
  value instanceof Date ? value.toISOString() : orNull(value);

// Rebuilt field by field so another version's lastError cannot fail the page.
const toLastError = (value) =>
  value
    ? {
        name: String(value.name ?? DEFAULT_ERROR_NAME),
        message: String(value.message ?? ""),
        at: toIso(value.at),
      }
    : null;

// A redrive with no operator is the platform's own: `by` is never null here.
const toLastRedrive = (value) =>
  value ? { at: toIso(value.at), by: actorName(value.by) } : null;

// Kept separate to stay inside the complexity max of 4.
const attemptField = (entry, key, fallback) => entry?.[key] ?? fallback;

const attemptStack = (entry) => {
  const stack = attemptField(entry, "stack", null);

  return stack === null ? null : String(stack);
};

const toAttemptEntry = (entry) => ({
  at: toIso(attemptField(entry, "at", null)),
  name: String(attemptField(entry, "name", DEFAULT_ERROR_NAME)),
  message: String(attemptField(entry, "message", "")),
  stack: attemptStack(entry),
});

export const toAttemptHistory = (history) =>
  normaliseAttemptHistory(history).map(toAttemptEntry);

const idTimestamp = (id) =>
  new Date(
    Number.parseInt(id.slice(0, ID_TIMESTAMP_CHARS), HEX) * MS_PER_SECOND,
  ).toISOString();

export const deriveTraceId = (traceparent) => {
  if (!traceparent) {
    return null;
  }

  return W3C_TRACEPARENT.exec(traceparent)?.[1] ?? traceparent;
};

// Never the empty string, which the label rule reads as "no type recorded".
const shortType = (storedType) =>
  storedType ? storedType.replace(NAMESPACE, "") || storedType : "";

export const shortEventType = (storedType, isAudit) =>
  storedType ? shortType(storedType) : labelForMissingType(isAudit);

// Only Caseworking recognises its own audit topic, so its label is verbatim.
const deriveType = (intermediate) =>
  intermediate.derivedType
    ? shortType(intermediate.derivedType)
    : shortEventType(
        intermediate.fullTypeRaw,
        isAuditTarget(intermediate.target),
      );

// `internal:message-bus` contains a colon too, so it is special-cased first.
const targetName = (target) => {
  if (!target) {
    return null;
  }

  if (target === INTERNAL_BUS) {
    return INTERNAL_BUS_NAME;
  }

  return target.slice(target.lastIndexOf(":") + 1);
};

const deriveEventId = (intermediate) =>
  orNull(intermediate.eventId) ?? intermediate.id;

const deriveCreatedAt = (createdAtIso, id) => createdAtIso ?? idTimestamp(id);

const toOrder = (createdAtIso) =>
  createdAtIso === null ? null : Date.parse(createdAtIso);

const buildRow = ({ service, box, intermediate, createdAtIso }) => ({
  service,
  box,
  id: intermediate.id,
  eventId: deriveEventId(intermediate),
  type: deriveType(intermediate),
  status: intermediate.status,
  ...statusDisplay(intermediate.status),
  createdAt: deriveCreatedAt(createdAtIso, intermediate.id),
});

// An inbox row carries no target, so its topic is null without a box check.
const attemptAndTargetFacts = (intermediate) => ({
  attempts: attemptsLabel(intermediate.attempts, intermediate.maxAttempts),
  targetTopic: targetName(intermediate.target),
  lastError: intermediate.lastError,
});

const buildListRow = (parts) => ({
  ...buildRow(parts),
  latency: latency(
    deriveCreatedAt(parts.createdAtIso, parts.intermediate.id),
    orNull(parts.intermediate.completedAt),
  ),
  latencyTitle: latencyTitle(parts.box),
});

// Both boxes list by publicationDate; inbox eventTime is the poller's order.
export const normaliseGasInbox = (doc, maxAttempts) => ({
  id: doc._id.toString(),
  cursorValue: toIsoIfDate(doc.publicationDate),
  eventId: orNull(doc.messageId),
  fullTypeRaw: orNull(doc.type),
  traceparent: orNull(doc.traceparent),
  target: null,
  status: doc.status,
  attempts: doc.completionAttempts,
  maxAttempts,
  lastError: toLastError(doc.lastError),
  completedAt: toIso(doc.completionDate),
  lastRedrive: toLastRedrive(doc.lastRedrive),
});

export const normaliseGasOutbox = (doc, maxAttempts) => {
  const event = doc.event ?? {};

  return {
    id: doc._id.toString(),
    cursorValue: toIsoIfDate(doc.publicationDate),
    eventId: orNull(event.id),
    fullTypeRaw: orNull(event.type),
    // An outbox row carries it inside the CloudEvent, not beside it.
    traceparent: orNull(event.traceparent),
    target: orNull(doc.target),
    status: doc.status,
    attempts: doc.completionAttempts,
    maxAttempts,
    lastError: toLastError(doc.lastError),
    completedAt: toIso(doc.completionDate),
    lastRedrive: toLastRedrive(doc.lastRedrive),
  };
};

// A Caseworking list row feeds only the list row, so only its fields are read.
export const normaliseCwListRow = (row) => ({
  id: row._id,
  cursorValue: orNull(row.publicationDate),
  eventId: orNull(row.eventId),
  fullTypeRaw: orNull(row.type),
  derivedType: orNull(row.type),
  target: null,
  status: row.status,
  completedAt: orNull(row.completedAt),
});

// cursorValue stays verbatim: re-canonicalising it would shift the page.
export const toEventTuple = ({ key, service, box, intermediate }) => {
  const createdAtIso = toIso(intermediate.cursorValue);

  return {
    key,
    order: toOrder(createdAtIso),
    cursorValue: intermediate.cursorValue,
    id: intermediate.id,
    row: buildListRow({ service, box, intermediate, createdAtIso }),
  };
};

export const toEventRow = ({ service, box, intermediate }) => ({
  ...buildRow({
    service,
    box,
    intermediate,
    createdAtIso: toIso(intermediate.cursorValue),
  }),
  ...attemptAndTargetFacts(intermediate),
});
