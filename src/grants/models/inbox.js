export class Inbox {
  constructor(props) {
    this._id = props._id;
    this.publicationDate = new Date().toISOString();
    this.type = props.type;
    this.hostname = props.hostname;
    this.event = props.event;
    this.messageId = props.messageId;
    this.lastResubmissionDate = props.lastResubmissionDate || null;
    this.completionAttempts = 1;
    this.status = props.status || InboxStatus.PUBLISHED;
    this.completionDate = props.completionDate || null;
    this.claimToken = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
    this.handler = props.handler; // string representation of the function to call
  }

  markAsComplete() {
    this.status = InboxStatus.COMPLETED;
    this.completionDate = new Date().toISOString();
    this.claimToken = null;
    this.claimedAt = null;
  }

  markAsFailed() {
    this.status = InboxStatus.FAILED;
    this.lastResubmissionDate = new Date().toISOString();
    this.completionAttempts += 1;
    this.claimToken = null;
    this.claimedAt = null;
  }

  toDocument() {
    return {
      _id: this._id,
      publicationDate: this.publicationDate,
      type: this.type,
      hostname: this.hostname,
      messageId: this.messageId,
      event: this.event,
      lastResubmissionDate: this.lastResubmissionDate,
      completionAttempts: this.completionAttempts,
      status: this.status,
      completionDate: this.completionDate,
      claimedAt: this.claimedAt,
      claimToken: this.claimToken,
      claimExpiresAt: this.claimExpiresAt,
      handler: this.handler,
    };
  }

  static fromDocument(doc) {
    return new Inbox({
      _id: doc._id,
      publicationDate: doc.publicationDate,
      type: doc.type,
      messageId: doc.messageId,
      hostname: this.hostname,
      event: doc.event,
      lastResubmissionDate: doc.lastResubmissionDate,
      completionAttempts: doc.completionAttempts,
      status: doc.status,
      completionDate: doc.completionDate,
      claimedAt: doc.claimedAt,
      claimToken: doc.claimToken,
      claimExpiresAt: doc.claimExpiresAt,
      handler: doc.handler,
    });
  }
}

export const InboxStatus = {
  PROCESSING: "PROCESSING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
  RESUBMITTED: "RESUBMITTED",
  DEAD: "DEAD",
};
