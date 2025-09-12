import { applicationStatus } from "../../common/application-status.js";

export class Application {
  constructor({
    clientRef,
    code,
    createdAt,
    submittedAt,
    identifiers,
    answers,
    agreements,
    status,
  }) {
    this.clientRef = clientRef;
    this.code = code;
    this.createdAt = createdAt ?? new Date().toISOString();
    this.submittedAt = submittedAt;
    this.identifiers = identifiers;
    this.answers = answers;
    this.currentPhase = "PRE_AWARD";
    this.currentStage = "application";
    this.agreements = agreements || {};
    this.status = status || applicationStatus.pending;
  }

  updateStatus(status) {
    this.currentPhase = "PRE_AWARD";
    this.currentStage = "AWARD";
    this.status = `${this.currentPhase}:${this.currentStage}:${status}`;
  }

  storeAgreement(agreementData) {
    const { agreementRef, agreementStatus, createdAt } = agreementData;
    const agreement = this.agreements[agreementRef];
    if (agreement) {
      agreement.history.push({
        createdAt,
        agreementStatus,
      });
      agreement.latestStatus = agreementStatus;
      agreement.updatedAt = createdAt;
    } else {
      this.agreements[agreementRef] = {
        latestStatus: agreementStatus,
        updatedAt: createdAt,
        history: [
          {
            createdAt,
            agreementStatus,
          },
        ],
      };
    }
  }
}
