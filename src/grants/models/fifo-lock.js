export class FifoLock {
  constructor(props) {
    this._id = props._id;
    this.locked = props.locked;
    this.segregationRef = props.segregationRef;
    this.lockedAt = props.lockedAt;
    this.actor = props.actor;
  }

  toDocument() {
    return {
      _id: this._id,
      locked: this.locked,
      segregationRef: this.segregationRef,
      lockedAt: this.lockedAt,
      actor: this.actor,
    };
  }

  static fromDocument(doc) {
    return new FifoLock({
      _id: doc._id,
      locked: !!doc.locked,
      segregationRef: doc.segregationRef,
      lockedAt: doc.lockedAt,
      actor: doc.actor,
    });
  }

  static createMock(obj) {
    return new FifoLock({
      _id: "1234",
      locked: true,
      segregationRef: "5678",
      lockedAt: new Date(Date.now),
      actor: "INBOX",
      ...obj,
    });
  }
}
