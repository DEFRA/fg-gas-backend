import { toRefs, toTraceId } from "../common/buckets/refs.js";
import { isAuditTarget } from "./event-audit.js";
import {
  AUDIT,
  INBOX,
  OUTBOX,
  UNRECOGNISED,
  findEventType,
  findEventTypeInAnyEnvironment,
} from "./event-types.js";

export const STAMPED_FIELDS = ["eventType", "refs"];

const unrecognised = { name: UNRECOGNISED, refs: () => [] };

// A type this service declares for another box is not one this box lists.
const declaredFor = (box, eventType) =>
  eventType?.boxes.includes(box) ? eventType : null;

const messageStamps = (eventType, event, { segregationRef, traceparent }) => ({
  eventType: eventType.name,
  refs: toRefs([
    ...eventType.refs(event, { segregationRef }),
    ["id", event.id],
    ["trace", toTraceId(traceparent)],
  ]),
});

const outboxMessageStamps = (eventType, event, segregationRef) =>
  messageStamps(eventType, event, {
    segregationRef,
    traceparent: event.traceparent,
  });

export const outboxStamps = (event, { segregationRef }) => {
  const eventType = declaredFor(OUTBOX, findEventType(event));

  if (!eventType) {
    throw new Error(`Event type "${event.type}" is not declared`);
  }

  return outboxMessageStamps(eventType, event, segregationRef);
};

export const inboxStamps = (message, { segregationRef }) =>
  messageStamps(
    declaredFor(INBOX, findEventType(message)) ?? unrecognised,
    message,
    { segregationRef, traceparent: message.traceparent },
  );

export const auditStamps = (payload) => ({
  eventType: AUDIT,
  refs: toRefs([["trace", payload.correlationid]]),
});

const envelopeOf = (doc) => doc.originalPayload ?? doc.event ?? {};

export const backfillOutboxStamps = (doc) => {
  const event = envelopeOf(doc);

  return isAuditTarget(doc.target)
    ? auditStamps(event)
    : outboxMessageStamps(
        declaredFor(OUTBOX, findEventTypeInAnyEnvironment(event)) ??
          unrecognised,
        event,
        doc.segregationRef,
      );
};

export const backfillInboxStamps = (doc) => {
  const event = envelopeOf(doc);

  return messageStamps(
    declaredFor(INBOX, findEventTypeInAnyEnvironment(event)) ?? unrecognised,
    event,
    { segregationRef: doc.segregationRef, traceparent: doc.traceparent },
  );
};

export const withoutStamps = (document) =>
  Object.fromEntries(
    Object.entries(document).filter(([key]) => !STAMPED_FIELDS.includes(key)),
  );
