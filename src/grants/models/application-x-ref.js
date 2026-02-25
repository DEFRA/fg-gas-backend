export class ApplicationXRef {
  constructor(props) {
    this._id = props._id;
    this.clientRefs = new Set(props.clientRefs);
    this.currentClientId = props.currentClientId;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  addClientRef(clientRef, clientId) {
    this.clientRefs.add(clientRef);
    this.currentClientId = clientId;
    this.updatedAt = new Date(Date.now()).toISOString();
  }

  static new({ clientRefs, currentClientId }) {
    const date = new Date(Date.now()).toISOString();
    return new ApplicationXRef({
      clientRefs,
      currentClientId,
      createdAt: date,
      updatedAt: date,
    });
  }

  toDocument() {
    return {
      _id: this._id,
      clientRefs: Array.from(this.clientRefs),
      currentClientId: this.currentClientId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
