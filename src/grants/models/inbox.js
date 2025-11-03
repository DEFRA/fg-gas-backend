export class Inbox {
  // eslint-disable-next-line complexity
  constructor(props) {
    this._id = props._id;
    this.publicationDate = new Date().toISOString();
    this.traceparent = props.traceparent;
    this.source = props.source;
    this.type = props.type;
    this.event = props.event;
    this.messageId = props.messageId;
    this.lastResubmissionDate = props.lastResubmissionDate || null;
    this.completionAttempts = props.completionAttempts || 1;
    this.status = props.status || InboxStatus.PUBLISHED;
    this.completionDate = props.completionDate || null;
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
  }

  markAsComplete() {
    this.status = InboxStatus.COMPLETED;
    this.completionDate = new Date().toISOString();
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
  }

  markAsFailed() {
    this.status = InboxStatus.FAILED;
    this.lastResubmissionDate = new Date().toISOString();
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
      completionAttempts: this.completionAttempts,
      status: this.status,
      completionDate: this.completionDate,
      claimedAt: this.claimedAt,
      claimedBy: this.claimedBy,
      claimExpiresAt: this.claimExpiresAt,
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
      completionAttempts: doc.completionAttempts,
      status: doc.status,
      completionDate: doc.completionDate,
      claimedAt: doc.claimedAt,
      claimedBy: doc.claimedBy,
      claimExpiresAt: doc.claimExpiresAt,
    });
  }
}

export const InboxStatus = {
  PROCESSING: "PROCESSING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
  RESUBMITTED: "RESUBMITTED",
  DEAD: "DEAD_LETTER",
};
