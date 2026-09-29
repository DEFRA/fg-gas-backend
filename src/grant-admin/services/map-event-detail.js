import { payloadRevisionOf } from "../../events/event-edit.js";
import { DEAD_LETTER } from "../../events/event-redrive.js";
import { expiryFrom } from "../../events/event-retention.js";
import { isPlainJson, withJsonNumbers } from "../../events/plain-json.js";
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

const toLastEdit = (value) =>
  value
    ? {
        at: toIso(value.at),
        by: actorName(value.by),
        note: toText(value.note, null),
      }
    : null;

const numberOrNull = (value) => (typeof value === "number" ? value : null);

const booleanOrNull = (value) => (typeof value === "boolean" ? value : null);

// The owning service computes both, so a Caseworking that cannot edit names
// neither and they read null; a null revision is what hides the admin's Edit
// button. Only Caseworking can tell whether its own row is plain JSON: its
// answer has already lost the BSON types.
const toEditFacts = (service, doc) =>
  service === CASEWORKING
    ? {
        payloadRevision: numberOrNull(doc.payloadRevision),
        payloadIsPlainJson: booleanOrNull(doc.payloadIsPlainJson),
      }
    : {
        payloadRevision: payloadRevisionOf(doc),
        payloadIsPlainJson: isPlainJson(doc.event),
      };

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

const payloadFacts = (service, doc) => ({
  payload: withJsonNumbers(doc.event ?? null),
  ...toEditFacts(service, doc),
  lastEdit: toLastEdit(doc.lastEdit),
  // Kept from the first edit for as long as the row is.
  originalPayload: withJsonNumbers(doc.originalPayload ?? null),
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
    ...payloadFacts(service, doc),
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
