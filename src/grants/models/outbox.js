import { getMessageGroupId } from "../../common/get-message-group-id.js";

export const OutboxStatus = {
  PUBLISHED: "PUBLISHED",
  PROCESSING: "PROCESSING",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
  RESUBMITTED: "RESUBMITTED",
  DEAD_LETTER: "DEAD_LETTER",
};

export class Outbox {
  constructor(props) {
    this._id = props._id;
    this.publicationDate = props.publicationDate || new Date();
    this.target = props.target;
    this.event = props.event;
    this.lastResubmissionDate = props.lastResubmissionDate;
    this.completionAttempts = props.completionAttempts || 1;
    this.status = props.status || OutboxStatus.PUBLISHED;
    this.completionDate = props.completionDate;
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
      target: this.target,
      event: this.event,
      lastResubmissionDate: this.lastResubmissionDate,
      completionAttempts: this.completionAttempts,
      status: this.status,
      completionDate: this.completionDate,
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
      completionAttempts: doc.completionAttempts,
      status: doc.status,
      completionDate: doc.completionDate,
      claimedAt: doc.claimedAt,
      claimedBy: doc.claimedBy,
      claimExpiresAt: doc.claimExpiresAt,
      segregationRef: doc.segregationRef,
    });
  }

  static createMock(doc) {
    return new Outbox({
      event: {
        messageGroupId: "foo-barr",
      },
      segregationRef: "1234",
      ...doc,
    });
  }
}
