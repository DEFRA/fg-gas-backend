export class AgreementItem {
  constructor(document) {
    this.document = document;
    this.agreementItemId = document.agreementItemId;
    this.clientRef = document.clientRef;
    this.configVersion = document.configVersion;
    this.identifiers = document.identifiers;
    this.payload = document.payload;
    this.createdAt = document.createdAt;
  }

  static create({ command, definition, now, agreementItemId }) {
    return new AgreementItem({
      agreementItemId,
      clientRef: command.clientRef,
      configVersion: definition.configVersion,
      identifiers: getItemIdentifiers(command),
      payload: structuredClone(command),
      createdAt: now,
    });
  }

  static fromDocument(document) {
    return new AgreementItem(document);
  }

  matches({ clientRef }) {
    return this.clientRef === clientRef;
  }

  toDocument() {
    const { payload, ...document } = this.document;
    return document;
  }

  toSnapshotDocument() {
    return this.document;
  }
}

const getItemIdentifiers = ({ identifiers = {}, metadata = {} }) => ({
  sbi: identifiers.sbi,
  frn: identifiers.frn,
  crn: identifiers.crn,
  defraId: metadata.defraId,
});
