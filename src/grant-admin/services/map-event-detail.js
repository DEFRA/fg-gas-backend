import {
  normaliseGasInbox,
  normaliseGasOutbox,
  orNull,
  toAttemptHistory,
  toEventRow,
  toIso,
} from "./map-event-row.js";

// The detail view of one event. Everything the list row carries, plus the
// fields the list deliberately leaves out: the whole `event` payload, the raw
// target ARN behind the row's topic name, the raw traceparent behind its
// traceId, and the claim/lifecycle timestamps.
//
// Both services are mapped by the *document* normalisers - the ones the GAS
// list uses on its own Mongo documents. Caseworking's detail endpoint answers
// with the whole stored document too, and a CW inbox/outbox document has the
// same shape as a GAS one (both services run the same inbox/outbox pattern),
// so the only difference is where `maxAttempts` comes from: GAS config for
// gas, the CW payload for caseworking. The `normaliseCw*` mappers exist only
// because CW pre-flattens its *list* rows, and are not used here.
const INBOX = "inbox";

const normaliseDocument = (box, doc, maxAttempts) =>
  box === INBOX
    ? normaliseGasInbox(doc, maxAttempts)
    : normaliseGasOutbox(doc, maxAttempts);

export const toEventDetail = ({ service, box, doc, maxAttempts }) => {
  const intermediate = normaliseDocument(box, doc, maxAttempts);

  return {
    ...toEventRow({ service, box, intermediate }),
    // verbatim, exactly as stored - the one place an event payload is returned
    payload: doc.event ?? null,
    // the full ARN; the row's `target` is only the topic name after the colon
    targetRaw: intermediate.target,
    messageId: orNull(doc.messageId),
    // the full W3C traceparent; the row's `traceId` is only the trace-id half
    traceparent: intermediate.traceparent,
    // Detail only, and identical whichever service the document came from: a
    // GAS document stores `attemptHistory` directly and Caseworking's detail
    // endpoint answers with the same three-key entries.
    attemptHistory: toAttemptHistory(doc.attemptHistory),
    // Who last put this row back in front of the poller, and when. Detail
    // only: the list rows carry `parked` (an operator needs to see poison at a
    // glance) but not this.
    lastRedrive: intermediate.lastRedrive,
    publicationDate: toIso(doc.publicationDate),
    completionDate: toIso(doc.completionDate),
    lastResubmissionDate: toIso(doc.lastResubmissionDate),
    claimedAt: toIso(doc.claimedAt),
    claimExpiresAt: toIso(doc.claimExpiresAt),
  };
};
