export class AgreementItem {
  constructor(document) {
    this.document = document;
    this.agreementItemId = document.agreementItemId;
    this.agreementCode = document.agreementCode;
    this.clientRef = document.clientRef;
    this.configVersion = document.configVersion;
    this.identifiers = document.identifiers;
    this.payload = document.payload;
    this.createdAt = document.createdAt;
  }

  static create({ command, definition, now, agreementItemId }) {
    return new AgreementItem({
      agreementItemId,
      agreementCode: definition.agreementCode,
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

  matches({ agreementCode, clientRef }) {
    return this.agreementCode === agreementCode && this.clientRef === clientRef;
  }

  toDocument() {
    return this.document;
  }
}

const getItemIdentifiers = ({ identifiers = {}, metadata = {} }) => ({
  frn: identifiers.frn,
  crn: identifiers.crn,
  defraId: metadata.defraId,
});
