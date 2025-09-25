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
    answers,
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
    this.answers = answers;
    this.agreements = agreements;
  }

  static new({ clientRef, code, submittedAt, identifiers, answers }) {
    const createdAt = new Date().toISOString();

    return new Application({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.Received,
      clientRef,
      code,
      submittedAt,
      createdAt,
      updatedAt: createdAt,
      identifiers,
      answers,
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
    this.updatedAt = this.#getTmestamp();
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
    this.currentStatus = ApplicationStatus.Review;
    this.currentStage = ApplicationStage.Award;
    this.updatedAt = this.#getTmestamp();
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

    this.currentStatus = ApplicationStatus.Accepted;
    this.updatedAt = this.#getTmestamp();
  }

  withdrawAgreement(agreementRef, date) {
    const agreement = this.agreements[agreementRef];

    if (!agreement) {
      throw Boom.badData(
        `Agreement "${agreementRef}" does not exist on application "${this.clientRef}"`,
      );
    }

    agreement.withdraw(date);

    this.currentStatus = ApplicationStatus.Withdrawn;
    this.updatedAt = this.#getTmestamp();
  }

  #getTmestamp() {
    return new Date().toISOString();
  }
}
