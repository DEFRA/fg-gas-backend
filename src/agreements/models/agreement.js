import { randomUUID } from "node:crypto";

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
    application,
    startDate,
    endDate,
    parcels,
    actions,
    items,
    annualAmountPence,
    totalAmountPence,
    paymentSchedule,
    state,
    createdAt,
    updatedAt,
    acceptedAt,
    paymentCalculation,
  }) {
    this.agreementNumber = agreementNumber;
    this.version = version;
    this.code = code;
    this.clientRef = clientRef;
    this.configVersion = configVersion;
    this.correlationId = correlationId;
    this.identifiers = structuredClone(identifiers);
    this.application = cloneOptional(application);
    this.startDate = startDate;
    this.endDate = endDate;
    this.parcels = cloneOptional(parcels);
    this.actions = cloneOptional(actions);
    this.items = cloneOptional(items);
    this.annualAmountPence = annualAmountPence;
    this.totalAmountPence = totalAmountPence;
    this.paymentSchedule = cloneOptional(paymentSchedule);
    this.state = state;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.acceptedAt = acceptedAt;
    this.paymentCalculation = cloneOptional(paymentCalculation);
  }

  transition({ target, transitionedAt, changes = {} }) {
    const transitionChanges = resolveTransitionChanges({
      agreement: this,
      changes,
      target,
      transitionedAt,
    });

    return new Agreement({
      ...this,
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
  paymentCalculation:
    options.changes.paymentCalculation ?? options.agreement.paymentCalculation,
});
