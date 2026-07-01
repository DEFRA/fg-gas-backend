import { randomUUID } from "node:crypto";

export class AgreementItem {
  constructor({
    agreementItemId,
    agreementCode,
    clientRef,
    sourceSystem,
    configVersion,
    identifiers,
    payload,
    createdAt,
  }) {
    this.agreementItemId = agreementItemId;
    this.agreementCode = agreementCode;
    this.clientRef = clientRef;
    this.sourceSystem = sourceSystem;
    this.configVersion = configVersion;
    this.identifiers = identifiers;
    this.payload = payload;
    this.createdAt = createdAt;
  }

  static new({
    agreementCode,
    clientRef,
    sourceSystem,
    configVersion,
    identifiers,
    payload,
  }) {
    return new AgreementItem({
      agreementItemId: randomUUID(),
      agreementCode,
      clientRef,
      sourceSystem,
      configVersion,
      identifiers,
      payload,
      createdAt: new Date().toISOString(),
    });
  }
}
