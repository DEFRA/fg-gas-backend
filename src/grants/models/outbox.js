export class Outbox {
  // eslint-disable-next-line complexity
  constructor({
    _id,
    target,
    event,
    completionAttempts = 1,
    status = OutboxStatus.PUBLISHED,
    publicationDate = new Date(),
    lastResubmissionDate = null,
    completionDate = null,
  }) {
    this._id = _id;
    this.publicationDate = publicationDate;
    this.target = target;
    this.event = event;
    this.lastResubmissionDate = lastResubmissionDate;
    this.completionAttempts = completionAttempts;
    this.status = status;
    this.completionDate = completionDate;
    this.claimToken = null;
    this.claimedAt = null;
  }

  markAsComplete() {
    this.status = OutboxStatus.COMPLETED;
    this.completionDate = new Date().toISOString();
    this.claimToken = null;
    this.claimedAt = null;
  }

  markAsFailed() {
    this.status = OutboxStatus.FAILED;
    this.lastResubmissionDate = new Date().toISOString();
    this.claimToken = null;
    this.claimedAt = null;
  }

  toDocument() {
    return {
      _id: this._id,
      publicationDate: this.publicationDate,
      target: this.target,
      event: this.event,
      lastResubmissionDate: this.lastResubmissionDate,
      completionAttempts: this.completionAttempts,
      status: this.status,
      completionDate: this.completionDate,
      claimedAt: this.claimedAt,
      claimToken: this.claimToken,
    };
  }

  static fromDocument(doc) {
    return new Outbox({
      _id: doc._id,
      publicationDate: doc.publicationDate,
      target: doc.target,
      event: doc.event,
      lastResubmissionDate: doc.lastResubmissionDate,
      completionAttempts: doc.completionAttempts,
      status: doc.status,
      completionDate: doc.completionDate,
      claimedAt: doc.claimedAt,
      claimToken: doc.claimToken,
    });
  }
}

export const OutboxStatus = {
  PROCESSING: "PROCESSING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
  RESUBMITTED: "RESUBMITTED",
  DEAD: "DEAD",
};
