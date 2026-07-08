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
    status,
    supplementaryData,
  }) {
    this.agreementItemId = agreementItemId;
    this.agreementCode = agreementCode;
    this.clientRef = clientRef;
    this.sourceSystem = sourceSystem;
    this.configVersion = configVersion;
    this.identifiers = identifiers;
    this.payload = payload;
    this.createdAt = createdAt;
    this.status = status;
    this.supplementaryData = supplementaryData;
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
