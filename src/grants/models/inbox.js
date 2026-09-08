import Boom from "@hapi/boom";
import Joi from "joi";
import {
  appendAttempt,
  normaliseAttemptHistory,
  toAttemptEntry,
  toLastError,
} from "../../events/last-error.js";

// The inbox's sort key, canonicalised on the way in.
//
// Everything downstream reads this as a Z-normalised, millisecond-precision
// ISO string: the keyset compares it as a STRING, the `from`/`to` bounds are
// string bounds, and the four-source merge orders by `Date.parse` of it. A
// CloudEvent `time` is none of those things by contract - it is optional, and
// an offset-bearing `2026-06-16T11:00:00+01:00` or a date-only `2026-06-16`
// are both valid. Stored verbatim, each one breaks a different reader: the
// lexical order stops matching the chronological one, the string bounds stop
// matching, and the merge's parsed order stops agreeing with the source's own
// keyset order - which is how a row gets permanently skipped across a page
// boundary rather than merely misplaced.
//
// So it is normalised once, here, where the row is not yet in anybody's
// cursor. A message with no usable time gets the moment it was received: an
// absent sort key would re-create the mixed-type bracket the migration exists
// to remove, and a null sorts nowhere at all.
const toSortableInstant = (time) => {
  const parsed =
    time === undefined || time === null ? Number.NaN : Date.parse(time);

  return Number.isNaN(parsed)
    ? new Date().toISOString()
    : new Date(parsed).toISOString();
};

export class Inbox {
  static validationSchema = Joi.object({
    source: Joi.string().required(),
    event: Joi.object().required(),
    segregationRef: Joi.string().required(),
  });

  // eslint-disable-next-line complexity
  constructor(props) {
    const { error } = Inbox.validationSchema.validate(props, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid Inbox: ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    this._id = props._id;
    // When this service RECEIVED the message - kept as written, never
    // re-stamped: stamping `now` on every construction (`fromDocument`
    // included) would make it the instant of the last write, and the admin
    // surface reads it as the receipt. Nothing in the poller reads it (inbox
    // rows order by `eventTime`). A row arriving without one is stamped now.
    this.publicationDate = props.publicationDate ?? new Date().toISOString();
    this.traceparent = props.traceparent;
    this.source = props.source;
    this.type = props.type;
    this.event = props.event;
    this.messageId = props.messageId;
    this.lastResubmissionDate = props.lastResubmissionDate || null;
    // Nullable and defaulted: every row written before FGP-1392 has no
    // `lastError` at all and must stay null end to end.
    this.lastError = props.lastError || null;
    // Defaulted to []: every row written before this change has no
    // `attemptHistory` at all and must read back as an empty history, never
    // as null - the detail view always renders the array.
    this.attemptHistory = normaliseAttemptHistory(props.attemptHistory);
    // ATTEMPT ARITHMETIC - counts attempts actually MADE: zero on a fresh
    // row, incremented by `markAsFailed` in the same call that pushes the
    // attempt-history entry, so the two always reconcile. Counting attempts
    // GRANTED instead (incrementing on the RESUBMITTED -> PUBLISHED sweep)
    // lets the dead-letter sweep in the same poll tick kill a row before its
    // final attempt runs - a DEAD_LETTER row reading "5/5" with only four
    // history entries.
    this.completionAttempts = props.completionAttempts ?? 0;
    this.status = props.status || InboxStatus.PUBLISHED;
    this.completionDate = props.completionDate || null;
    // `{ at, by }` for the most recent redrive of this row, so the detail view
    // can say who put it back in front of the poller. Null until redriven.
    this.lastRedrive = props.lastRedrive ?? null;
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
    this.segregationRef = props.segregationRef;
    this.eventTime = toSortableInstant(props.event?.time);
  }

  markAsComplete() {
    this.status = InboxStatus.COMPLETED;
    this.completionDate = new Date().toISOString();
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
  }

  // `error` is the exception the handler caught. Absent (a resubmission
  // sweep, an old caller) leaves the previous `lastError` in place.
  markAsFailed(error) {
    this.status = InboxStatus.FAILED;
    this.lastResubmissionDate = new Date().toISOString();
    this.lastError = toLastError(error) ?? this.lastError;
    // Appended, never replaced: the history is the record of every attempt,
    // and `markAsComplete` deliberately leaves it in place so a row that
    // eventually succeeded still shows what it took.
    this.attemptHistory = appendAttempt(
      this.attemptHistory,
      toAttemptEntry(error),
    );
    // Counted here, in the same call that records the failure, so the counter
    // and the history can never disagree - see ATTEMPT ARITHMETIC above.
    this.completionAttempts += 1;
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
  }

  toDocument() {
    return {
      _id: this._id,
      traceparent: this.traceparent,
      publicationDate: this.publicationDate,
      source: this.source,
      type: this.type,
      messageId: this.messageId,
      event: this.event,
      lastResubmissionDate: this.lastResubmissionDate,
      lastError: this.lastError,
      attemptHistory: this.attemptHistory,
      completionAttempts: this.completionAttempts,
      status: this.status,
      completionDate: this.completionDate,
      lastRedrive: this.lastRedrive,
      claimedAt: this.claimedAt,
      claimedBy: this.claimedBy,
      claimExpiresAt: this.claimExpiresAt,
      eventTime: this.eventTime,
      segregationRef: this.segregationRef,
    };
  }

  static fromDocument(doc) {
    return new Inbox({
      _id: doc._id,
      publicationDate: doc.publicationDate,
      traceparent: doc.traceparent,
      source: doc.source,
      type: doc.type,
      messageId: doc.messageId,
      event: doc.event,
      lastResubmissionDate: doc.lastResubmissionDate,
      lastError: doc.lastError,
      attemptHistory: doc.attemptHistory,
      completionAttempts: doc.completionAttempts,
      status: doc.status,
      completionDate: doc.completionDate,
      lastRedrive: doc.lastRedrive,
      claimedAt: doc.claimedAt,
      claimedBy: doc.claimedBy,
      claimExpiresAt: doc.claimExpiresAt,
      eventTime: doc.eventTime,
      segregationRef: doc.segregationRef,
    });
  }

  static createMock(obj) {
    return new Inbox({
      _id: "1234",
      publicationDate: new Date(Date.now()),
      traceparent: "mock-trace-parent",
      source: "CW",
      type: "type",
      messageId: "message-id",
      event: {
        time: new Date().toISOString(),
      },
      completionAttempts: 1,
      status: "PUBLISHED",
      eventTime: new Date().toISOString(),
      segregationRef: "mock-segregation-ref",
      ...obj,
    });
  }
}

export const InboxStatus = {
  PROCESSING: "PROCESSING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
  RESUBMITTED: "RESUBMITTED",
  DEAD_LETTER: "DEAD_LETTER",
};
