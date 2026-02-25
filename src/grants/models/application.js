import Boom from "@hapi/boom";
import Joi from "joi";
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
  static validationSchema = Joi.object({
    clientRef: Joi.string().required(),
    code: Joi.string().required(),
    phases: Joi.array().required(),
    replacementAllowed: Joi.boolean().required(),
  });

  constructor(props) {
    const { error } = Application.validationSchema.validate(props, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid Application: ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    const {
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
      replacementAllowed,
    } = props;

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
    this.replacementAllowed = replacementAllowed;
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
      replacementAllowed: false,
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

  acceptAgreement(agreementNumber, agreementDates) {
    const agreement = this.agreements[agreementNumber];

    if (!agreement) {
      throw Boom.badData(
        `Agreement "${agreementNumber}" does not exist on application "${this.clientRef}"`,
      );
    }

    agreement.accept(agreementDates);
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
      acceptedDate: agreement.acceptedDate,
      startDate: agreement.startDate,
      endDate: agreement.endDate,
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
