import { randomUUID } from "node:crypto";
import { resolveAgreementIdentitySequence } from "./agreement-identity-sequence.js";

const cloneOptional = (value) =>
  value === undefined ? undefined : structuredClone(value);

export class Agreement {
  constructor({
    agreementNumber,
    version,
    code,
    clientRef,
    configVersion,
    correlationId,
    identifiers,
    schemeCode,
    name,
    applicant,
    application,
    startDate,
    endDate,
    parcels,
    actions,
    items,
    annualAmountPence,
    totalAmountPence,
    paymentSchedule,
    identitySequence,
    state,
    createdAt,
    updatedAt,
    acceptedAt,
  }) {
    this.agreementNumber = agreementNumber;
    this.version = version;
    this.code = code;
    this.clientRef = clientRef;
    this.configVersion = configVersion;
    this.correlationId = correlationId;
    this.identifiers = structuredClone(identifiers);
    this.schemeCode = schemeCode;
    this.name = name;
    this.applicant = cloneOptional(applicant);
    this.application = cloneOptional(application);
    this.startDate = startDate;
    this.endDate = endDate;
    this.parcels = cloneOptional(parcels);
    this.actions = cloneOptional(actions);
    this.items = cloneOptional(items);
    this.annualAmountPence = annualAmountPence;
    this.totalAmountPence = totalAmountPence;
    this.paymentSchedule = cloneOptional(paymentSchedule);
    this.identitySequence = resolveAgreementIdentitySequence({
      actions,
      identitySequence,
      items,
      paymentSchedule,
    });
    this.state = state;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.acceptedAt = acceptedAt;
  }

  transition({ target, transitionedAt, values }) {
    const transitionChanges = resolveTransitionChanges({
      agreement: this,
      target,
      transitionedAt,
    });

    return new Agreement({
      ...this,
      ...values,
      ...transitionChanges,
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
    correlationId = randomUUID(),
    identifiers,
    values,
    state,
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
      ...values,
      state,
      createdAt,
      updatedAt: createdAt,
    });
  }
}

const resolveAcceptedAt = ({ agreement, target, transitionedAt }) =>
  agreement.acceptedAt ?? (target === "accepted" ? transitionedAt : undefined);

const resolveTransitionChanges = (options) => ({
  acceptedAt: resolveAcceptedAt(options),
});
