import Boom from "@hapi/boom";
import Joi from "joi";
import { ObjectId } from "mongodb";
import { isObjectIdHex } from "../../common/object-id-hex.js";
import {
  appendAttempt,
  normaliseAttemptHistory,
  toAttemptEntry,
  toLastError,
} from "../../events/last-error.js";
import { isRetryableFailure } from "../../events/retryable.js";

const toEpochMs = (time) => {
  if (time === undefined || time === null) {
    return Number.NaN;
  }

  return time instanceof Date ? time.getTime() : Date.parse(time);
};

const insertedAt = (id) => {
  if (id instanceof ObjectId) {
    return id.getTimestamp();
  }

  return isObjectIdHex(id)
    ? ObjectId.createFromHexString(id).getTimestamp()
    : new Date();
};

const toSortableInstant = (time, fallback = () => new Date()) => {
  const parsed = toEpochMs(time);

  return Number.isNaN(parsed)
    ? fallback().toISOString()
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
    // Never re-stamped: an unreadable receipt falls back to the insert time, as the migration does.
    this.publicationDate = toSortableInstant(props.publicationDate, () =>
      insertedAt(props._id),
    );
    this.traceparent = props.traceparent;
    this.source = props.source;
    this.type = props.type;
    this.event = props.event;
    this.messageId = props.messageId;
    this.lastResubmissionDate = props.lastResubmissionDate || null;
    this.lastError = props.lastError || null;
    this.attemptHistory = normaliseAttemptHistory(props.attemptHistory);
    // Attempts made, counted with the history entry so a sweep cannot kill a row early.
    this.completionAttempts = props.completionAttempts ?? 0;
    this.status = props.status || InboxStatus.PUBLISHED;
    // Missing means retryable, so rows written before this existed are unaffected.
    this.retryable = props.retryable ?? true;
    this.completionDate = props.completionDate || null;
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

  markAsFailed(error) {
    this.status = InboxStatus.FAILED;
    this.retryable = isRetryableFailure(error);
    this.lastResubmissionDate = new Date().toISOString();
    this.lastError = toLastError(error) ?? this.lastError;
    this.attemptHistory = appendAttempt(
      this.attemptHistory,
      toAttemptEntry(error),
    );
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
      retryable: this.retryable,
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
      retryable: doc.retryable,
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
      publicationDate: new Date().toISOString(),
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
