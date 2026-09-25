import { DEAD_LETTER } from "../../events/event-redrive.js";
import { expiryFrom } from "../../events/event-retention.js";
import { actorName } from "./event-display.js";
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

// Rebuilt field by field, like `lastError`: another version's record must not
// fail response validation.
const toText = (value, fallback) =>
  value === null || value === undefined ? fallback : String(value);

const toLastPurge = (value) =>
  value
    ? {
        at: toIso(value.at),
        by: actorName(value.by),
        reasonCode: toText(value.reasonCode, ""),
        note: toText(value.note, null),
      }
    : null;

// When this row would be deleted if it were purged now, and the admin's
// signal that purging it is possible at all. The owning service computes it,
// so a Caseworking without a purge endpoint names no key and this reads null.
const toPurgeDeletionDate = ({ service, doc, status, retentionDays }) => {
  if (service === CASEWORKING) {
    return toIso(doc.purgeDeletionDate);
  }

  return status === DEAD_LETTER
    ? toIso(expiryFrom(new Date(), retentionDays))
    : null;
};

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

export const toEventDetail = ({
  service,
  box,
  doc,
  maxAttempts,
  retentionDays,
}) => {
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
    // Kept through a redrive, so the admin can show "Previously purged".
    lastPurge: toLastPurge(doc.lastPurge),
    purgeDeletionDate: toPurgeDeletionDate({
      service,
      doc,
      status: row.status,
      retentionDays,
    }),
    expiresAt: toIso(doc.expireAt),
    completionDate: toIso(doc.completionDate),
    lastResubmissionDate: toIso(doc.lastResubmissionDate),
  };
};
