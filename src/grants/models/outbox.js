import Boom from "@hapi/boom";
import Joi from "joi";
import { getMessageGroupId } from "../../common/get-message-group-id.js";
import {
  appendAttempt,
  normaliseAttemptHistory,
  toAttemptEntry,
  toLastError,
} from "../../common/last-error.js";

export const OutboxStatus = {
  PUBLISHED: "PUBLISHED",
  PROCESSING: "PROCESSING",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
  RESUBMITTED: "RESUBMITTED",
  DEAD_LETTER: "DEAD_LETTER",
};

export class Outbox {
  static validationSchema = Joi.object({
    target: Joi.string().required(),
    event: Joi.object().required(),
    segregationRef: Joi.string().required(),
  });

  // eslint-disable-next-line complexity
  constructor(props) {
    const { error } = Outbox.validationSchema.validate(props, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid Outbox: ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    this._id = props._id;
    // Always a BSON Date: a document read back with a legacy *string*
    // publicationDate must not be written out as a string again, or it would
    // re-introduce the mixed-type keyset fault that
    // migrations/20260901130000-normalise-event-sort-keys.js exists to fix.
    this.publicationDate = props.publicationDate
      ? new Date(props.publicationDate)
      : new Date();
    this.target = props.target;
    this.event = props.event;
    this.lastResubmissionDate = props.lastResubmissionDate;
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
    this.status = props.status || OutboxStatus.PUBLISHED;
    this.completionDate = props.completionDate;
    // `{ at, by }` for the most recent redrive of this row, so the detail view
    // can say who put it back in front of the poller. Null until redriven.
    this.lastRedrive = props.lastRedrive ?? null;
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
    this.segregationRef = props.segregationRef;
  }

  markAsComplete() {
    this.status = OutboxStatus.COMPLETED;
    this.completionDate = new Date().toISOString();
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
  }

  // `error` is the exception the publisher caught. Absent (a resubmission
  // sweep, an old caller) leaves the previous `lastError` in place.
  markAsFailed(error) {
    this.status = OutboxStatus.FAILED;
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
      publicationDate: this.publicationDate,
      target: this.target,
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
      segregationRef: this.segregationRef,
    };
  }

  static getSegregationRef(event) {
    const { data } = event;
    return getMessageGroupId(null, data);
  }

  static fromDocument(doc) {
    return new Outbox({
      _id: doc._id,
      publicationDate: doc.publicationDate,
      target: doc.target,
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
      segregationRef: doc.segregationRef,
    });
  }

  static createMock(doc) {
    return new Outbox({
      target: "arn:aws:sns:eu-west-2:000000000000:mock-topic",
      event: {
        messageGroupId: "foo-barr",
      },
      segregationRef: "1234",
      ...doc,
    });
  }
}
