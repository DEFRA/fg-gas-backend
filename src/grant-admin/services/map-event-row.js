// Two wire shapes feed one derivation: GAS rows are raw projected Mongo
// documents (`_id` an ObjectId, `event.*` still nested, `publicationDate` a
// Date), CW rows are pre-flattened by CW's own `mapDocument` (`_id` a hex
// string, `createdAt` already derived, no `event` key at all). Each source has
// its own normaliser; only the shared derivation below is allowed to guess.

const NAMESPACE = /^cloud\.defra\.[^.]+\.[^.]+\./;
const INTERNAL_BUS = "internal:message-bus";
const INTERNAL_BUS_NAME = "internal";
const NO_TYPE = "-";
const HEX = 16;
// `00-<32 hex trace-id>-<16 hex span-id>-<flags>`; OpenSearch's `trace.id`
// holds only the trace-id half. Anything else (a bare CDP request id) is
// already the value OpenSearch indexes, so it is passed through untouched.
const W3C_TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-/i;
const ID_TIMESTAMP_CHARS = 8;
const MS_PER_SECOND = 1000;

const isMissing = (value) => value === null || value === undefined;

const orNull = (value) => (isMissing(value) ? null : value);

const toIso = (value) => {
  const date = isMissing(value) ? null : new Date(value);

  return date === null || Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
};

// `publicationDate` is a native Date on GAS outbox documents; anything else is
// left exactly as stored so the keyset boundary is never re-canonicalised.
const toIsoIfDate = (value) =>
  value instanceof Date ? value.toISOString() : orNull(value);

// The first four bytes of an ObjectId are its creation time in seconds.
const idTimestamp = (id) =>
  new Date(
    parseInt(id.slice(0, ID_TIMESTAMP_CHARS), HEX) * MS_PER_SECOND,
  ).toISOString();

// Audit rows are recognised structurally: a GAS document carries
// `event.audit.entities`, a CW row carries `auditEntities`. Presence of the
// array is the only signal - an empty array is still an audit row.
const isAudit = (intermediate) => Array.isArray(intermediate.auditEntities);

// Audit payloads carry no traceparent at all (their `correlationid` is a
// different identifier and is deliberately never used), so audit rows get a
// null traceId and the frontend renders no link.
const deriveTraceId = (traceparent) => {
  if (!traceparent) {
    return null;
  }

  return W3C_TRACEPARENT.exec(traceparent)?.[1] ?? traceparent;
};

const auditType = (entities) => {
  const first = entities[0] ?? {};

  return first.entity && first.action
    ? `audit · ${first.entity}.${first.action}`
    : NO_TYPE;
};

const shortType = (fullType) =>
  fullType ? fullType.replace(NAMESPACE, "") : "";

const domainType = (fullType) => shortType(fullType) || NO_TYPE;

const deriveType = (intermediate) =>
  isAudit(intermediate)
    ? auditType(intermediate.auditEntities)
    : domainType(intermediate.fullTypeRaw);

const deriveFullType = (intermediate) =>
  isAudit(intermediate) ? null : orNull(intermediate.fullTypeRaw);

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
  completedAt: orNull(intermediate.completedAt),
});

export const normaliseGasInbox = (doc, maxAttempts) => ({
  id: doc._id.toString(),
  cursorValue: orNull(doc.eventTime),
  eventId: orNull(doc.messageId),
  fullTypeRaw: orNull(doc.type),
  auditEntities: null,
  traceparent: orNull(doc.traceparent),
  source: orNull(doc.source),
  target: null,
  segregationRef: orNull(doc.segregationRef),
  status: doc.status,
  attempts: doc.completionAttempts,
  maxAttempts,
  lastFailureAt: toIso(doc.lastResubmissionDate),
  completedAt: toIso(doc.completionDate),
});

export const normaliseGasOutbox = (doc, maxAttempts) => {
  const event = doc.event ?? {};
  const audit = event.audit ?? {};

  return {
    id: doc._id.toString(),
    cursorValue: toIsoIfDate(doc.publicationDate),
    eventId: orNull(event.id),
    fullTypeRaw: orNull(event.type),
    auditEntities: orNull(audit.entities),
    traceparent: orNull(event.traceparent),
    source: null,
    target: orNull(doc.target),
    segregationRef: orNull(doc.segregationRef),
    status: doc.status,
    attempts: doc.completionAttempts,
    maxAttempts,
    lastFailureAt: toIso(doc.lastResubmissionDate),
    completedAt: toIso(doc.completionDate),
  };
};

export const normaliseCwInbox = (row) => ({
  id: row._id,
  cursorValue: orNull(row.createdAt),
  eventId: orNull(row.eventId),
  fullTypeRaw: orNull(row.type),
  auditEntities: null,
  traceparent: orNull(row.traceparent),
  source: orNull(row.source),
  target: null,
  segregationRef: orNull(row.segregationRef),
  status: row.status,
  attempts: row.completionAttempts,
  maxAttempts: orNull(row.maxAttempts),
  lastFailureAt: orNull(row.lastFailureAt),
  completedAt: orNull(row.completedAt),
});

export const normaliseCwOutbox = (row) => ({
  id: row._id,
  cursorValue: orNull(row.createdAt),
  eventId: orNull(row.eventId),
  fullTypeRaw: orNull(row.type),
  auditEntities: orNull(row.auditEntities),
  traceparent: orNull(row.traceparent),
  source: null,
  target: orNull(row.target),
  segregationRef: orNull(row.segregationRef),
  status: row.status,
  attempts: row.completionAttempts,
  maxAttempts: orNull(row.maxAttempts),
  lastFailureAt: orNull(row.lastFailureAt),
  completedAt: orNull(row.completedAt),
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
