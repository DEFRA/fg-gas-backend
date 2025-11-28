import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";

export const AgreementStatus = {
  Accepted: "accepted",
  Withdrawn: "withdrawn",
  Offered: "offered",
  Rejected: "rejected",
};

export const handleAgreementStatusChangeUseCase = async (command, session) => {
  const { eventData } = command;
  const { status } = eventData;

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

  logger.info(
    `Finished: Handling agreement status change for agreement ${eventData.agreementNumber} with status ${status}`,
  );

  throw Boom.badData(
    `Can not update agreement status. Unsupported agreement status "${status}"`,
  );
};
