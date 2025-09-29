import { UUID } from 'mongodb';

export class EventPublication {
  constructor({
    _id = new UUID(),
    publicationDate = new Date(),
    listenerId,
    event,
    lastResubmissionDate = new Date(),
    completionAttempts = 0,
    status = 'PENDING',
    completionDate = null
  }) {
    this._id = _id;
    this.publicationDate = publicationDate;
    this.listenerId = listenerId;
    this.event = event;
    this.lastResubmissionDate = lastResubmissionDate;
    this.completionAttempts = completionAttempts;
    this.status = status;
    this.completionDate = completionDate;
  }

  markAsPublished() {
    this.status = 'PUBLISHED';
    this.completionDate = new Date();
  }

  markAsFailed() {
    this.status = 'FAILED';
    this.lastResubmissionDate = new Date();
  }

  incrementAttempts() {
    this.completionAttempts += 1;
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
      completionDate: this.completionDate
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
      completionDate: doc.completionDate
    });
  }
}

export const EventPublicationStatus = {
  PENDING: 'PENDING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED'
};
