import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { ApplicationStatus } from "../models/application.js";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";
import { withdrawAgreementUseCase } from "./withdraw-agreement.use-case.js";
import { withdrawApplicationUseCase } from "./withdraw-application.use-case.js";

export const AgreementStatus = {
  Accepted: "accepted",
  Withdrawn: "withdrawn",
  Offered: "offered",
  Rejected: "rejected",
};

export const sourceSystems = {
  CaseWorking: "CW",
  AgreementService: "AS",
};

// eslint-disable-next-line complexity
export const handleAgreementStatusChangeUseCase = async (command, session) => {
  const { eventData, sourceSystem } = command;
  const { status, currentStatus } = eventData;

  logger.info(
    `Handling agreement status change for agreement ${eventData.agreementNumber} with status ${status}`,
  );

  if (status === AgreementStatus.Accepted) {
    logger.info(
      `Handling accepted agreement status change for agreement ${eventData.agreementNumber}`,
    );
    await acceptAgreementUseCase(command, session);
    logger.info(
      `Finished: Handling accepted agreement status change for agreement ${eventData.agreementNumber}`,
    );
    return;
  }

  if (status === AgreementStatus.Withdrawn) {
    await withdrawAgreementUseCase(command, session);
    return;
  }

  if (sourceSystem === sourceSystems.CaseWorking) {
    // case working commands use currentStatus which is fully qualified...
    const statusParts = currentStatus.split(":");
    if (
      statusParts[statusParts.length - 1] ===
      ApplicationStatus.WithdrawRequested
    ) {
      await withdrawApplicationUseCase(command, session);
      return;
    }
  }

  throw Boom.badData(
    `Error: Handling accepted agreement status change for agreement ${eventData.agreementNumber} with status ${status}. Status unsupported.`,
  );
};
