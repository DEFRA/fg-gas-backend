import { randomUUID } from "node:crypto";

export class Agreement {
  constructor({
    agreementNumber,
    version,
    code,
    clientRef,
    configVersion,
    correlationId,
    identifiers,
    payload,
    state,
    createdAt,
    updatedAt,
    acceptedAt,
    paymentCalculation,
    supplementaryData,
  }) {
    this.agreementNumber = agreementNumber;
    this.version = version;
    this.code = code;
    this.clientRef = clientRef;
    this.configVersion = configVersion;
    this.correlationId = correlationId;
    this.identifiers = structuredClone(identifiers);
    this.payload = structuredClone(payload);
    this.state = state;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.acceptedAt = acceptedAt;
    this.paymentCalculation = cloneOptional(paymentCalculation);
    this.supplementaryData = cloneOptional(supplementaryData);
  }

  transition({ target, transitionedAt, changes = {} }) {
    return new Agreement({
      ...this,
      ...resolveTransitionChanges(this, changes),
      state: target,
      version: this.version + 1,
      updatedAt: transitionedAt,
    });
  }

  static create({
    agreementNumber,
    code,
    clientRef,
    configVersion,
    identifiers,
    payload,
    state,
    correlationId = randomUUID(),
    createdAt = new Date().toISOString(),
  }) {
    return new Agreement({
      agreementNumber,
      version: 1,
      code,
      clientRef,
      configVersion,
      correlationId,
      identifiers,
      payload,
      state,
      createdAt,
      updatedAt: createdAt,
    });
  }
}

const cloneOptional = (value) =>
  value === undefined ? undefined : structuredClone(value);

const resolveTransitionChanges = (agreement, changes) => ({
  acceptedAt: changes.acceptedAt ?? agreement.acceptedAt,
  paymentCalculation:
    changes.paymentCalculation ?? agreement.paymentCalculation,
  supplementaryData: changes.supplementaryData ?? agreement.supplementaryData,
});
