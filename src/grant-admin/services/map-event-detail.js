import { CASEWORKING } from "./event-sources.js";
import {
  deriveFullType,
  deriveTraceId,
  normaliseGasInbox,
  normaliseGasOutbox,
  orNull,
  toAttemptHistory,
  toEventRow,
  toIso,
} from "./map-event-row.js";

// The detail view of one event.
//
// Both services are mapped by the *document* normalisers: Caseworking's
// detail endpoint answers with the whole stored document, which has the same
// shape as a GAS one, so the only difference is where `maxAttempts` comes
// from. The `normaliseCw*` mappers exist only because CW pre-flattens its
// *list* rows, and are not used here.
const INBOX = "inbox";

const normaliseDocument = (box, doc, maxAttempts) =>
  box === INBOX
    ? normaliseGasInbox(doc, maxAttempts)
    : normaliseGasOutbox(doc, maxAttempts);

// Null where the long form says nothing the short one does not, so the
// frontend hangs a title on it without comparing anything.
const toTypeTitle = (intermediate, type) => {
  const full = deriveFullType(intermediate);

  return full === type ? null : full;
};

// Inbox-only, and ABSENT rather than null on an outbox row - see the detail
// response schema.
const inboxFacts = (doc, intermediate) => ({
  segregationRef: orNull(doc.segregationRef),
  // the full W3C traceparent, and the trace-id half OpenSearch indexes
  traceparent: intermediate.traceparent,
  traceId: deriveTraceId(intermediate.traceparent),
});

const payloadFacts = (doc) => ({
  // verbatim, exactly as stored - the one place an event payload is returned
  payload: doc.event ?? null,
  occurredAt: toIso(doc.event?.time),
  messageGroupId: orNull(doc.event?.messageGroupId),
});

// Each service is authoritative for its own rows, on the detail exactly as on
// the list.
//
// A Caseworking document is normalised here by the GAS document normalisers -
// the two services store the same shape - and those produce no service label,
// so the derivation fell through to GAS's own audit predicate applied to a
// CASEWORKING target. It cannot recognise one: a type-less Caseworking audit
// row listed as "audit", from that service's own label, and detailed as
// "unknown". Caseworking states both labels on the document it answers with,
// so they are taken verbatim here, which is what the list has always done.
const serviceLabels = (service, doc) =>
  service === CASEWORKING
    ? { derivedType: orNull(doc.type), derivedFullType: orNull(doc.fullType) }
    : {};

export const toEventDetail = ({ service, box, doc, maxAttempts }) => {
  const intermediate = {
    ...normaliseDocument(box, doc, maxAttempts),
    ...serviceLabels(service, doc),
  };
  const row = toEventRow({ service, box, intermediate });

  return {
    ...row,
    typeTitle: toTypeTitle(intermediate, row.type),
    ...payloadFacts(doc),
    ...(box === INBOX ? inboxFacts(doc, intermediate) : {}),
    attemptHistory: toAttemptHistory(doc.attemptHistory),
    lastRedrive: intermediate.lastRedrive,
    publicationDate: toIso(doc.publicationDate),
    completionDate: toIso(doc.completionDate),
    lastResubmissionDate: toIso(doc.lastResubmissionDate),
    claimedAt: toIso(doc.claimedAt),
    claimExpiresAt: toIso(doc.claimExpiresAt),
  };
};
