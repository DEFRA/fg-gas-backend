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
    state,
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
    this.state = state;
    this.supplementaryData = supplementaryData;
  }

  static create({
    agreementCode,
    clientRef,
    sourceSystem,
    configVersion,
    identifiers,
    payload,
    state,
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
      state,
    });
  }
}
