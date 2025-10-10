export class Outbox {
  constructor(props) {
    this._id = props._id;
    this.publicationDate = props.publicationDate || new Date().toISOString();
    this.owner = props.owner;
    this.target = props.target;
    this.event = props.event;
    this.lastResubmissionDate = props.lastResubmissionDate;
    this.completionAttempts = props.completionAttempts | 1;
    this.status = props.status || OutboxStatus.PUBLISHED;
    this.completionDate = props.completionDate;
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
  }

  markAsComplete() {
    this.status = OutboxStatus.COMPLETED;
    this.completionDate = new Date().toISOString();
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
  }

  markAsFailed() {
    this.status = OutboxStatus.FAILED;
    this.lastResubmissionDate = new Date().toISOString();
    this.claimedBy = null;
    this.claimedAt = null;
    this.claimExpiresAt = null;
  }

  toDocument() {
    return {
      _id: this._id,
      publicationDate: this.publicationDate,
      owner: this.owner,
      target: this.target,
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
    return new Outbox({
      _id: doc._id,
      publicationDate: doc.publicationDate,
      owner: doc.owner,
      target: doc.target,
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

export const OutboxStatus = {
  PROCESSING: "PROCESSING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
  RESUBMITTED: "RESUBMITTED",
  DEAD_LETTER: "DEAD_LETTER",
};
