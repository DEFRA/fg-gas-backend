export class EventPublication {
  // eslint-disable-next-line complexity
  constructor({
    _id,
    listenerId,
    event,
    completionAttempts = 0,
    status = EventPublicationStatus.PUBLISHED,
    publicationDate = new Date(),
    lastResubmissionDate = null,
    completionDate = null,
  }) {
    this._id = _id;
    this.publicationDate = publicationDate;
    this.listenerId = listenerId;
    this.event = event;
    this.lastResubmissionDate = lastResubmissionDate;
    this.completionAttempts = completionAttempts;
    this.status = status;
    this.completionDate = completionDate;
    this.claimToken = null;
    this.claimedAt = null;
  }

  markAsComplete() {
    this.status = EventPublicationStatus.COMPLETED;
    this.completionDate = new Date().toISOString();
    this.claimToken = null;
    this.claimedAt = null;
  }

  markAsFailed() {
    this.status = EventPublicationStatus.FAILED;
    this.lastResubmissionDate = new Date().toISOString();
    this.completionAttempts += 1;
    this.claimToken = null;
    this.claimedAt = null;
  }

  toDocument() {
    return {
      _id: this._id,
      publicationDate: this.publicationDate,
      listenerId: this.listenerId,
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
    return new EventPublication({
      _id: doc._id,
      publicationDate: doc.publicationDate,
      listenerId: doc.listenerId,
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

export const EventPublicationStatus = {
  PENDING: "PENDING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
};
