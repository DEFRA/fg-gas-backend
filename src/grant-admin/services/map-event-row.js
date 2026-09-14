import {
  fullTypeForMissingType,
  isAuditTarget,
  labelForMissingType,
} from "../../events/event-audit.js";
import { normaliseAttemptHistory } from "../../events/last-error.js";
import {
  actorName,
  attemptsLabel,
  hopLabel,
  latency,
  latencyTitle,
  queueLine,
  showsAttempts,
  startedAt,
  statusDisplay,
} from "./event-display.js";

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

// Same rebuild for the redrive record. Detail only. `by` is never null on the
// way out: a redrive with no operator recorded is the platform's own, and it
// goes out under the name that absence has - see `actorName`. Both services'
// documents come through here, so neither can spell it differently.
const toLastRedrive = (value) =>
  value ? { at: toIso(value.at), by: actorName(value.by) } : null;

// Rebuilt entry by entry for the same reason as `lastError`, and capped again
// on the way out. `attemptField` is kept separate so the rebuild stays inside
// the configured complexity max of 4.
const attemptField = (entry, key, fallback) => entry?.[key] ?? fallback;

// The stack IS served here - the attempts section expands to reveal it - but
// it is still a declared key rebuilt like every other, never a stored object
// spread onto the answer. Null on an entry that has none: rows written before
// stacks were recorded, a claim-expiry sweep, a thrown string.
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

// Detail only - list rows deliberately carry `lastError` and nothing more.
export const toAttemptHistory = (history) =>
  normaliseAttemptHistory(history).map(toAttemptEntry);

// The first four bytes of an ObjectId are its creation time in seconds.
const idTimestamp = (id) =>
  new Date(
    Number.parseInt(id.slice(0, ID_TIMESTAMP_CHARS), HEX) * MS_PER_SECOND,
  ).toISOString();

// Audit payloads carry no traceparent at all (their `correlationid` is a
// different identifier and is deliberately never used), so audit rows get a
// null traceId and the frontend renders no link.
export const deriveTraceId = (traceparent) => {
  if (!traceparent) {
    return null;
  }

  return W3C_TRACEPARENT.exec(traceparent)?.[1] ?? traceparent;
};

// A type that is nothing but a namespace falls back to the stored value: it
// must never become the empty string, which the label rule below reads as
// "no type recorded".
const shortType = (storedType) =>
  storedType ? storedType.replace(NAMESPACE, "") || storedType : "";

// For a row that stored no type, the label comes from events/event-audit.js -
// the same predicate that decides the default-page exclusion, so label and
// filter cannot disagree. Exported so the breakdown merges on exactly the
// string the list rows show.
export const shortEventType = (storedType, isAudit) =>
  storedType ? shortType(storedType) : labelForMissingType(isAudit);

// Only Caseworking can recognise its own audit topic, so a CW row arrives
// already labelled (`derivedType`) and that label is taken verbatim - deriving
// it here could only guess. The namespace strip still runs over it: a no-op on
// `audit`/`unknown`, and it formats a real type like every other row's.
const deriveType = (intermediate) =>
  intermediate.derivedType
    ? shortType(intermediate.derivedType)
    : shortEventType(
        intermediate.fullTypeRaw,
        isAuditTarget(intermediate.target),
      );

// Detail only. Decided by the same predicate as the short label, so the two
// can never disagree about what a row is.
export const deriveFullType = (intermediate) =>
  intermediate.derivedFullType ||
  intermediate.fullTypeRaw ||
  fullTypeForMissingType(isAuditTarget(intermediate.target));

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

// `lastError.at` answers first: a redrive leaves `lastResubmissionDate`
// behind on a row that has since completed, which would date a failure the
// row no longer has. The resubmission stands in only for rows written before
// `lastError` was recorded.
const deriveLastFailureAt = (intermediate) =>
  orNull(intermediate.lastError?.at ?? intermediate.lastFailureAt);

// `service`, `box` and `id` travel raw because the frontend builds the row's
// link from them; everything else with a display form is decided in
// event-display.js.
const buildRow = ({ service, box, intermediate, createdAtIso }) => ({
  service,
  box,
  id: intermediate.id,
  eventId: deriveEventId(intermediate),
  type: deriveType(intermediate),
  hop: hopLabel({ service, box }),
  ...queueLine({
    service,
    box,
    source: orNull(intermediate.source),
    target: targetName(intermediate.target),
  }),
  status: intermediate.status,
  ...statusDisplay(intermediate.status),
  createdAt: deriveCreatedAt(createdAtIso, intermediate.id),
  lastError: intermediate.lastError,
});

// Only the single-row answers count attempts. The list's Status column draws
// a state, a duration and a reason; it stopped drawing an attempt count, so
// the list row stopped carrying one.
const attemptFacts = (intermediate) => {
  const failedAt = deriveLastFailureAt(intermediate);

  return {
    attempts: attemptsLabel(intermediate.attempts, intermediate.maxAttempts),
    showAttempts: showsAttempts(intermediate.attempts, failedAt !== null),
    lastFailureAt: failedAt,
  };
};

const buildListRow = (parts) => ({
  ...buildRow(parts),
  latency: latency(
    deriveCreatedAt(parts.createdAtIso, parts.intermediate.id),
    orNull(parts.intermediate.completedAt),
  ),
  latencyTitle: latencyTitle(parts.box),
});

// Deliberately not the list row: a hop's `took` is timed from when ITS box
// took the message, so a slow producer-to-broker leg is not booked to the
// consumer - a different question from the list row's `latency`.
export const toJourneyHop = ({ service, box, intermediate, createdAtIso }) => {
  const createdAt = deriveCreatedAt(createdAtIso, intermediate.id);
  const began = startedAt({
    box,
    createdAt,
    publicationDate: orNull(intermediate.publicationDate),
  });

  return {
    service,
    box,
    id: intermediate.id,
    hop: hopLabel({ service, box }),
    status: intermediate.status,
    ...statusDisplay(intermediate.status),
    startedAt: began,
    took: latency(began, orNull(intermediate.completedAt)),
  };
};

export const normaliseGasInbox = (doc, maxAttempts) => ({
  id: doc._id.toString(),
  cursorValue: orNull(doc.eventTime),
  eventId: orNull(doc.messageId),
  fullTypeRaw: orNull(doc.type),
  // Detail only: the list projection leaves `traceparent` out, so it is null
  // there, and only the detail mapper - fed the whole document - reads it.
  traceparent: orNull(doc.traceparent),
  source: orNull(doc.source),
  target: null,
  status: doc.status,
  attempts: doc.completionAttempts,
  maxAttempts,
  // On an inbox document: the moment this service received it.
  publicationDate: toIso(doc.publicationDate),
  lastFailureAt: toIso(doc.lastResubmissionDate),
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
    source: null,
    target: orNull(doc.target),
    status: doc.status,
    attempts: doc.completionAttempts,
    maxAttempts,
    // On an outbox document: the queue time, and its sort key.
    publicationDate: toIso(doc.publicationDate),
    lastFailureAt: toIso(doc.lastResubmissionDate),
    lastError: toLastError(doc.lastError),
    completedAt: toIso(doc.completionDate),
    lastRedrive: toLastRedrive(doc.lastRedrive),
  };
};

// A CW list row carries only what the page draws; the detail view reads whole
// documents through the GAS normalisers instead.
export const normaliseCwInbox = (row) => ({
  id: row._id,
  cursorValue: orNull(row.createdAt),
  eventId: orNull(row.eventId),
  fullTypeRaw: orNull(row.type),
  // Taken verbatim - see deriveType.
  derivedType: orNull(row.type),
  source: orNull(row.source),
  target: null,
  status: row.status,
  attempts: row.completionAttempts,
  maxAttempts: orNull(row.maxAttempts),
  lastFailureAt: orNull(row.lastFailureAt),
  lastError: toLastError(row.lastError),
  completedAt: orNull(row.completedAt),
});

export const normaliseCwOutbox = (row) => ({
  id: row._id,
  cursorValue: orNull(row.createdAt),
  eventId: orNull(row.eventId),
  fullTypeRaw: orNull(row.type),
  derivedType: orNull(row.type),
  source: null,
  target: orNull(row.target),
  status: row.status,
  attempts: row.completionAttempts,
  maxAttempts: orNull(row.maxAttempts),
  lastFailureAt: orNull(row.lastFailureAt),
  lastError: toLastError(row.lastError),
  completedAt: orNull(row.completedAt),
});

// `cursorValue` (verbatim keyset position) and `createdAt` (display value)
// are deliberately two different fields: re-canonicalising the keyset
// boundary would shift the page.
export const toEventTuple = ({ key, service, box, intermediate }) => {
  const createdAtIso = toIso(intermediate.cursorValue);

  return {
    key,
    order: toOrder(createdAtIso),
    cursorValue: intermediate.cursorValue,
    id: intermediate.id,
    row: buildListRow({ service, box, intermediate, createdAtIso }),
    // Both shapes are built for every row: building the pair costs an object
    // per row, while asking the query layer which shape the caller wanted
    // would thread a display concern through it.
    hop: toJourneyHop({ service, box, intermediate, createdAtIso }),
  };
};

// The row without the keyset scaffolding or the list's duration figure, plus
// the attempt facts - for the detail and redrive responses, which draw the
// attempts and not the duration. The list is the mirror image.
export const toEventRow = ({ service, box, intermediate }) => ({
  ...buildRow({
    service,
    box,
    intermediate,
    createdAtIso: toIso(intermediate.cursorValue),
  }),
  ...attemptFacts(intermediate),
});
