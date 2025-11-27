import Boom from "@hapi/boom";
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

  if (status === AgreementStatus.Accepted) {
    await acceptAgreementUseCase(command, session);

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
    `Can not update agreement status. Unsupported agreement status "${status}"`,
  );
};
