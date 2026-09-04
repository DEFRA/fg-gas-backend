import { normaliseAttemptHistory } from "../../common/last-error.js";

// Two wire shapes feed one derivation: GAS rows are raw projected Mongo
// documents (`_id` an ObjectId, `event.*` still nested, `publicationDate` a
// Date), CW rows are pre-flattened by CW's own `mapDocument` (`_id` a hex
// string, `createdAt` already derived, no `event` key at all). Each source has
// its own normaliser; only the shared derivation below is allowed to guess.

const NAMESPACE = /^cloud\.defra\.[^.]+\.[^.]+\./;
const INTERNAL_BUS = "internal:message-bus";
const INTERNAL_BUS_NAME = "internal";
const HEX = 16;
// `00-<32 hex trace-id>-<16 hex span-id>-<flags>`; OpenSearch's `trace.id`
// holds only the trace-id half. Anything else (a bare CDP request id) is
// already the value OpenSearch indexes, so it is passed through untouched.
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

// `publicationDate` is a native Date on GAS outbox documents; anything else is
// left exactly as stored so the keyset boundary is never re-canonicalised.
const toIsoIfDate = (value) =>
  value instanceof Date ? value.toISOString() : orNull(value);

// Rebuilt field by field rather than passed through: a `lastError` written by
// an older or newer service version must not fail response validation for the
// whole page. Absent on every row written before FGP-1392, hence null.
const toLastError = (value) =>
  value
    ? {
        name: String(value.name ?? DEFAULT_ERROR_NAME),
        message: String(value.message ?? ""),
        at: toIso(value.at),
      }
    : null;

// Rebuilt from its three contract keys, exactly as `lastError` is: a `parked`
// object written by an older or newer service version must not fail response
// validation for the whole page. Null on every row that is not PARKED.
const toParked = (value) =>
  value
    ? {
        at: toIso(value.at),
        reason: String(value.reason ?? ""),
        by: orNull(value.by),
      }
    : null;

// Same rebuild for the redrive record. Detail only.
const toLastRedrive = (value) =>
  value ? { at: toIso(value.at), by: orNull(value.by) } : null;

// Rebuilt entry by entry, exactly as `lastError` is, and capped again on the
// way out: a history written by an older or newer service version - or by
// neither, on every row that predates attempt history - must render rather
// than fail response validation for the whole detail view.
// Reading one key off an entry that may be absent or malformed, kept separate
// so the rebuild below stays inside the configured complexity max of 4.
const attemptField = (entry, key, fallback) => entry?.[key] ?? fallback;

const toAttemptEntry = (entry) => ({
  at: toIso(attemptField(entry, "at", null)),
  name: String(attemptField(entry, "name", DEFAULT_ERROR_NAME)),
  message: String(attemptField(entry, "message", "")),
});

// Always an array, never null. Used by the detail mapper only - list rows
// deliberately carry `lastError` and nothing more.
export const toAttemptHistory = (history) =>
  normaliseAttemptHistory(history).map(toAttemptEntry);

// The first four bytes of an ObjectId are its creation time in seconds.
const idTimestamp = (id) =>
  new Date(
    parseInt(id.slice(0, ID_TIMESTAMP_CHARS), HEX) * MS_PER_SECOND,
  ).toISOString();

// Audit payloads carry no traceparent at all (their `correlationid` is a
// different identifier and is deliberately never used), so audit rows get a
// null traceId and the frontend renders no link.
const deriveTraceId = (traceparent) => {
  if (!traceparent) {
    return null;
  }

  return W3C_TRACEPARENT.exec(traceparent)?.[1] ?? traceparent;
};

const shortType = (fullType) =>
  fullType ? fullType.replace(NAMESPACE, "") : "";

// The display form of a stored event type, and NULL for a row that has none.
// Exported so the breakdown merges on exactly the string the list rows show -
// a group and the rows it counts must read the same.
//
// Null rather than a placeholder string: an audit record is not a CloudEvent
// and genuinely has no type, so nothing is invented for it here. The frontend
// renders the absence; the API states it. Every other row goes through this
// same path - there is no audit-specific derivation left.
export const shortEventType = (fullType) => shortType(fullType) || null;

const deriveType = (intermediate) => shortEventType(intermediate.fullTypeRaw);

const deriveFullType = (intermediate) => orNull(intermediate.fullTypeRaw);

// A full ARN is never returned: only the topic name after the last colon.
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
  fullType: deriveFullType(intermediate),
  source: orNull(intermediate.source),
  target: targetName(intermediate.target),
  segregationRef: orNull(intermediate.segregationRef),
  status: intermediate.status,
  attempts: intermediate.attempts,
  maxAttempts: intermediate.maxAttempts,
  traceId: deriveTraceId(intermediate.traceparent),
  createdAt: deriveCreatedAt(createdAtIso, intermediate.id),
  lastFailureAt: orNull(intermediate.lastFailureAt),
  lastError: intermediate.lastError,
  completedAt: orNull(intermediate.completedAt),
  parked: intermediate.parked,
});

export const normaliseGasInbox = (doc, maxAttempts) => ({
  id: doc._id.toString(),
  cursorValue: orNull(doc.eventTime),
  eventId: orNull(doc.messageId),
  fullTypeRaw: orNull(doc.type),
  traceparent: orNull(doc.traceparent),
  source: orNull(doc.source),
  target: null,
  segregationRef: orNull(doc.segregationRef),
  status: doc.status,
  attempts: doc.completionAttempts,
  maxAttempts,
  lastFailureAt: toIso(doc.lastResubmissionDate),
  lastError: toLastError(doc.lastError),
  completedAt: toIso(doc.completionDate),
  parked: toParked(doc.parked),
  lastRedrive: toLastRedrive(doc.lastRedrive),
});

export const normaliseGasOutbox = (doc, maxAttempts) => {
  const event = doc.event ?? {};

  return {
    id: doc._id.toString(),
    cursorValue: toIsoIfDate(doc.publicationDate),
    eventId: orNull(event.id),
    fullTypeRaw: orNull(event.type),
    traceparent: orNull(event.traceparent),
    source: null,
    target: orNull(doc.target),
    segregationRef: orNull(doc.segregationRef),
    status: doc.status,
    attempts: doc.completionAttempts,
    maxAttempts,
    lastFailureAt: toIso(doc.lastResubmissionDate),
    lastError: toLastError(doc.lastError),
    completedAt: toIso(doc.completionDate),
    parked: toParked(doc.parked),
    lastRedrive: toLastRedrive(doc.lastRedrive),
  };
};

export const normaliseCwInbox = (row) => ({
  id: row._id,
  cursorValue: orNull(row.createdAt),
  eventId: orNull(row.eventId),
  fullTypeRaw: orNull(row.type),
  traceparent: orNull(row.traceparent),
  source: orNull(row.source),
  target: null,
  segregationRef: orNull(row.segregationRef),
  status: row.status,
  attempts: row.completionAttempts,
  maxAttempts: orNull(row.maxAttempts),
  lastFailureAt: orNull(row.lastFailureAt),
  lastError: toLastError(row.lastError),
  completedAt: orNull(row.completedAt),
  parked: toParked(row.parked),
  lastRedrive: toLastRedrive(row.lastRedrive),
});

export const normaliseCwOutbox = (row) => ({
  id: row._id,
  cursorValue: orNull(row.createdAt),
  eventId: orNull(row.eventId),
  fullTypeRaw: orNull(row.type),
  traceparent: orNull(row.traceparent),
  source: null,
  target: orNull(row.target),
  segregationRef: orNull(row.segregationRef),
  status: row.status,
  attempts: row.completionAttempts,
  maxAttempts: orNull(row.maxAttempts),
  lastFailureAt: orNull(row.lastFailureAt),
  lastError: toLastError(row.lastError),
  completedAt: orNull(row.completedAt),
  parked: toParked(row.parked),
  lastRedrive: toLastRedrive(row.lastRedrive),
});

// `cursorValue` (verbatim keyset position) and `createdAt` (display value) are
// deliberately two different fields - see the plan's anti-canonicalisation note.
export const toEventTuple = ({ key, service, box, intermediate }) => {
  const createdAtIso = toIso(intermediate.cursorValue);

  return {
    key,
    order: toOrder(createdAtIso),
    cursorValue: intermediate.cursorValue,
    id: intermediate.id,
    row: buildRow({ service, box, intermediate, createdAtIso }),
  };
};

// The same row the list renders, without the keyset scaffolding around it -
// used by the detail and redrive responses so a row means the same thing
// wherever the frontend sees it.
export const toEventRow = ({ service, box, intermediate }) =>
  buildRow({
    service,
    box,
    intermediate,
    createdAtIso: toIso(intermediate.cursorValue),
  });
