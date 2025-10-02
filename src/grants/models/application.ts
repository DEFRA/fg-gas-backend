import Boom from "@hapi/boom";
import {Grant} from "./grant.js";
import {LifecyclePosition} from "./lifecycle-position";

export const ApplicationPhase = {
  PreAward: "PRE_AWARD",
};

export const ApplicationStage = {
  Assessment: "ASSESSMENT",
  Award: "AWARD",
};

export const ApplicationStatus = {
  Received: "RECEIVED",
  Offered: "OFFERED",
  Accepted: "OFFER_ACCEPTED",
  Rejected: "OFFER_REJECTED",
  Withdrawn: "OFFER_WITHDRAWN",
};

export class Application {

  currentPhase: string;
  currentStage: string;
  currentStatus: string;
  readonly clientRef: string;
  readonly code: string;
  readonly createdAt: Date;

  transitionStage(grant, targetPhase, targetStage, targetStatus) {
      throw new Error("Method not implemented.");
  }
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
    this.currentStatus = ApplicationStatus.Offered;
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

  transitionStatus(grant: Grant, targetPhase: string, targetStage: string, targetStatus: string) : AdditionalProcesses {

    // grantStageStatuses would be a Map<string, Status>
    const pos : LifecyclePosition = {phase: this.currentPhase, stage: this.currentStage, status: null}
    const grantStageStatuses = grant.findStatuses(pos);
    const targetedStatus = grantStageStatuses[targetStatus];
    const transitionInfo = targetedStatus.transitionInfo(this.currentStatus);
    if (transitionInfo.validFrom.contains(this.currentStatus)) {
      return transitionInfo.processes;
    } else {
      return { processes:[] };
    }
  }

}

export type AdditionalProcesses = {
  processes: string[];
}
