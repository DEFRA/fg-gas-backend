import Boom from "@hapi/boom";
import Joi from "joi";
import { ObjectId } from "mongodb";
import { config } from "../../common/config.js";
import { isObjectIdHex } from "../../common/object-id-hex.js";
import { expiryFrom } from "../event-retention.js";
import {
  appendAttempt,
  normaliseAttemptHistory,
  toAttemptEntry,
  toLastError,
} from "../last-error.js";
import { isRetryableFailure } from "../retryable.js";

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
    // Set on completion only, and must round-trip: the repository `$set`s the
    // whole document, so a field missing here is erased on the next save.
    this.expireAt = props.expireAt ?? null;
    this.lastRedrive = props.lastRedrive ?? null;
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
    this.segregationRef = props.segregationRef;
    this.eventTime = toSortableInstant(props.event?.time);
  }

  // The columns an inbox row derives from its event, so an edited event is
  // claimed in its new order at once rather than after the next poller save.
  static eventColumns(event) {
    return {
      type: event.type ?? null,
      eventTime: toSortableInstant(event.time),
    };
  }

  markAsComplete() {
    // One clock reading, so the deadline is exactly the window from completion.
    const completedAt = new Date();

    this.status = InboxStatus.COMPLETED;
    this.completionDate = completedAt.toISOString();
    this.expireAt = expiryFrom(completedAt, config.events.retentionDays);
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
  }

  // A failure retrying cannot fix goes straight to the dead letter queue, which is this
  // system's word for "given up on": it keeps its reason, shows in the dead-letter
  // breakdown, and an operator can redrive it. Sitting in FAILED it could do none of those.
  markAsFailed(error) {
    this.retryable = isRetryableFailure(error);
    this.status = this.retryable ? InboxStatus.FAILED : InboxStatus.DEAD_LETTER;
    this.expireAt = null;
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
      expireAt: this.expireAt,
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
      expireAt: doc.expireAt,
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
  PURGED: "PURGED",
};
