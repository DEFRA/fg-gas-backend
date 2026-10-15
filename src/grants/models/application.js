import Boom from "@hapi/boom";
import Joi from "joi";
import { AgreementStatus } from "./agreement.js";
import { Position } from "./position.js";

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
  });

  // eslint-disable-next-line complexity
  constructor(props) {
    const { position, ...values } = props;
    const { error } = Application.validationSchema.validate(values, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid Application: ${error.details.map((d) => d.message).join(", ")}`,
      );
    }

    if (!(position instanceof Position)) {
      throw Boom.badRequest(
        'Invalid Application: "position" must be a Position',
      );
    }

    const {
      clientRef,
      code,
      configVersion,
      originalConfigVersion,
      currentConfigVersion,
      createdAt,
      updatedAt,
      submittedAt,
      identifiers,
      metadata,
      phases,
      agreements,
    } = values;

    this.position = position;
    this.clientRef = clientRef;
    this.code = code;
    this.originalConfigVersion = originalConfigVersion ?? configVersion ?? null;
    this.currentConfigVersion = currentConfigVersion ?? configVersion ?? null;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.submittedAt = submittedAt;
    this.identifiers = identifiers;
    this.metadata = metadata ?? {};
    this.phases = phases;
    this.agreements = agreements;
  }

  static new({
    position,
    clientRef,
    code,
    configVersion,
    submittedAt,
    identifiers,
    metadata,
    phases,
  }) {
    const createdAt = new Date().toISOString();

    return new Application({
      position,
      clientRef,
      code,
      originalConfigVersion: configVersion,
      currentConfigVersion: configVersion,
      submittedAt,
      createdAt,
      updatedAt: createdAt,
      identifiers,
      metadata,
      phases,
      agreements: {},
    });
  }

  isReplacementAllowed(positions) {
    return positions.some((position) => this.position.hasSameCode(position));
  }

  approve() {
    if (this.position.status === ApplicationStatus.Approved) {
      throw new Error(
        `Application with clientRef "${this.clientRef}" and code "${this.code}" is already approved`,
      );
    }

    this.position = this.position.withStatus(ApplicationStatus.Approved);
    this.updatedAt = this.#getTimestamp();
  }

  canMoveTo(targetPosition, grant) {
    return (
      this.position.equals(targetPosition) ||
      grant.isValidTransition(targetPosition, this.position).valid
    );
  }

  moveTo(targetPosition, grant) {
    const previous = this.position;

    if (previous.equals(targetPosition)) {
      return { changed: false, previous, new: previous, processes: [] };
    }

    const transition = grant.isValidTransition(targetPosition, previous);
    if (!transition.valid) {
      throw Boom.badRequest(
        `Invalid transition from "${previous}" to "${targetPosition}"`,
      );
    }

    this.position = targetPosition;
    this.updatedAt = this.#getTimestamp();

    return {
      changed: true,
      previous,
      new: targetPosition,
      processes: transition.processes ?? [],
    };
  }

  referenceContext() {
    const answers = (this.phases ?? []).reduce(
      (merged, phase) => ({ ...merged, ...(phase.answers ?? {}) }),
      {},
    );

    return {
      clientRef: this.clientRef,
      code: this.code,
      phase: this.position.phase,
      stage: this.position.stage,
      status: this.position.status,
      identifiers: this.identifiers ?? {},
      answers,
    };
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

  getAcceptedAgreement() {
    return Object.values(this.agreements).find(
      (agg) => agg.latestStatus === AgreementStatus.Accepted,
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

  cancelAgreement(agreementRef, date) {
    const agreement = this.agreements[agreementRef];

    if (!agreement) {
      throw Boom.badData(
        `Agreement "${agreementRef}" does not exist on application "${this.clientRef}"`,
      );
    }

    agreement.cancel(date);
    this.updatedAt = this.#getTimestamp();
  }

  withdraw() {
    this.position = this.position.withStatus(ApplicationStatus.Withdrawn);
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

  terminateAgreement(agreementRef, date) {
    const agreement = this.agreements[agreementRef];

    if (!agreement) {
      throw Boom.badData(
        `Agreement "${agreementRef}" does not exist on application "${this.clientRef}"`,
      );
    }

    agreement.terminate(date);
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
    const phase = this.phases?.find((p) => p.code === this.position.phase);
    return phase?.answers ?? {};
  }

  #getTimestamp() {
    return new Date().toISOString();
  }
}
