import Boom from "@hapi/boom";
import { AgreementStatus } from "./agreement.js";

export const ApplicationPhase = {
  PreAward: "PRE_AWARD",
};

export const ApplicationStage = {
  Assessment: "ASSESSMENT",
  Award: "AWARD",
};

export const ApplicationStatus = {
  Approved: "APPLICATION_APPROVED",
  Received: "APPLICATION_RECEIVED",
  Review: "IN_REVIEW",
  Accepted: "OFFER_ACCEPTED",
  Rejected: "OFFER_REJECTED",
  Withdrawn: "APPLICATION_WITHDRAWN",
  WithdrawRequested: "WITHDRAWAL_REQUESTED",
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
    metadata,
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
    this.metadata = metadata ?? {};
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
    metadata,
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
      metadata,
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

  getActiveAgreement() {
    return Object.values(this.agreements).find(
      (agg) => agg.latestStatus === AgreementStatus.Offered,
    );
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

  withdraw() {
    this.currentStatus = ApplicationStatus.Withdrawn;
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
