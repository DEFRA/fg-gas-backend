import Boom from "@hapi/boom";
import Joi from "joi";
import {
  appendAttempt,
  normaliseAttemptHistory,
  toAttemptEntry,
  toLastError,
} from "../../common/last-error.js";

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
    this.publicationDate = new Date().toISOString();
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
    // ATTEMPT ARITHMETIC - this counts attempts that have actually been MADE,
    // so it starts at zero on a freshly inserted row and is incremented by
    // `markAsFailed`, in the same call that pushes the attempt-history entry.
    // The two therefore always reconcile. It used to default to 1 here and be
    // incremented by the RESUBMITTED -> PUBLISHED sweep instead, which counted
    // attempts GRANTED rather than made: the sweep raised the counter to the
    // cap and the dead-letter sweep - which runs later in the same poll tick -
    // killed the row before that final attempt ever ran, leaving a
    // DEAD_LETTER row reading "5/5" with only four history entries.
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
    this.eventTime = props.event.time;
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
