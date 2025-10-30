import Boom from "@hapi/boom";

export const ApplicationPhase = {
  PreAward: "PRE_AWARD",
};

export const ApplicationStage = {
  Assessment: "ASSESSMENT",
  Award: "AWARD",
};

export const ApplicationStatus = {
  Approved: "APPROVED",
  Received: "RECEIVED",
  Review: "REVIEW",
  Accepted: "OFFER_ACCEPTED",
  Rejected: "OFFER_REJECTED",
  Withdrawn: "OFFER_WITHDRAWN",
};

export class Application {
  constructor({
    currentPhase,
    currentStage,
    currentStatus,
    clientRef,
    code,
    createdAt,
    updatedAt,
    submittedAt,
    identifiers,
    phases,
    agreements,
  }) {
    this.currentPhase = currentPhase;
    this.currentStage = currentStage;
    this.currentStatus = currentStatus;
    this.clientRef = clientRef;
    this.code = code;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.submittedAt = submittedAt;
    this.identifiers = identifiers;
    this.phases = phases;
    this.agreements = agreements;
  }

  static new({
    currentPhase,
    currentStage,
    currentStatus,
    clientRef,
    code,
    submittedAt,
    identifiers,
    phases,
  }) {
    const createdAt = new Date().toISOString();

    return new Application({
      currentPhase,
      currentStage,
      currentStatus,
      clientRef,
      code,
      submittedAt,
      createdAt,
      updatedAt: createdAt,
      identifiers,
      phases,
      agreements: {},
    });
  }

  approve() {
    if (this.currentStatus === ApplicationStatus.Approved) {
      throw new Error(
        `Application with clientRef "${this.clientRef}" and code "${this.code}" is already approved`,
      );
    }

    this.currentStatus = ApplicationStatus.Approved;
    this.updatedAt = this.#getTimestamp();
  }

  getFullyQualifiedStatus() {
    return `${this.currentPhase}:${this.currentStage}:${this.currentStatus}`;
  }

  addAgreement(agreement) {
    if (this.agreements[agreement.agreementRef]) {
      throw Boom.conflict(
        `Agreement "${agreement.agreementRef}" already exists on application "${this.clientRef}"`,
      );
    }

    this.agreements[agreement.agreementRef] = agreement;
    this.updatedAt = this.#getTimestamp();
  }

  getAgreement(agreementRef) {
    return this.agreements[agreementRef] || null;
  }

  acceptAgreement(agreementRef, date) {
    const agreement = this.agreements[agreementRef];

    if (!agreement) {
      throw Boom.badData(
        `Agreement "${agreementRef}" does not exist on application "${this.clientRef}"`,
      );
    }

    agreement.accept(date);
    this.updatedAt = this.#getTimestamp();
  }

  withdrawAgreement(agreementRef, date) {
    const agreement = this.agreements[agreementRef];

    if (!agreement) {
      throw Boom.badData(
        `Agreement "${agreementRef}" does not exist on application "${this.clientRef}"`,
      );
    }

    agreement.withdraw(date);

    this.updatedAt = this.#getTimestamp();
  }

  getAgreementsData() {
    return Object.values(this.agreements).map((agreement) => ({
      agreementRef: agreement.agreementRef,
      agreementStatus: agreement.latestStatus,
      createdAt: agreement.history[0]?.createdAt,
      updatedAt: agreement.updatedAt,
    }));
  }

  getAnswers() {
    const phase = this.phases?.find((p) => p.code === this.currentPhase);
    return phase?.answers ?? {};
  }

  #getTimestamp() {
    return new Date().toISOString();
  }
}
