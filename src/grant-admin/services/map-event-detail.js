import { CASEWORKING } from "./event-sources.js";
import {
  deriveTraceId,
  normaliseGasInbox,
  normaliseGasOutbox,
  orNull,
  toAttemptHistory,
  toEventRow,
  toIso,
} from "./map-event-row.js";

// Caseworking's detail is a whole stored document, so the GAS normalisers map it too.
const INBOX = "inbox";

const normaliseDocument = (box, doc, maxAttempts) =>
  box === INBOX
    ? normaliseGasInbox(doc, maxAttempts)
    : normaliseGasOutbox(doc, maxAttempts);

const payloadFacts = (doc) => ({
  payload: doc.event ?? null,
});

// GAS cannot recognise Caseworking's audit topic, so CW's own label is taken verbatim.
const serviceLabels = (service, doc) =>
  service === CASEWORKING ? { derivedType: orNull(doc.type) } : {};

export const toEventDetail = ({ service, box, doc, maxAttempts }) => {
  const intermediate = {
    ...normaliseDocument(box, doc, maxAttempts),
    ...serviceLabels(service, doc),
  };
  const row = toEventRow({ service, box, intermediate });

  return {
    ...row,
    ...payloadFacts(doc),
    traceId: deriveTraceId(intermediate.traceparent),
    segregationRef: orNull(doc.segregationRef),
    attemptHistory: toAttemptHistory(doc.attemptHistory),
    lastRedrive: intermediate.lastRedrive,
    expiresAt: toIso(doc.expireAt),
    completionDate: toIso(doc.completionDate),
    lastResubmissionDate: toIso(doc.lastResubmissionDate),
  };
};
