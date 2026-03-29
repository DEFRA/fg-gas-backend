import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { UpdateAgreementStatusCommand } from "../events/update-agreement-status.command.js";
import { AgreementServiceStatus } from "../models/agreement.js";
import { Outbox } from "../models/outbox.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const requestAgreementTerminationUseCase = async (
  { clientRef, code },
  session,
) => {
  logger.info(
    `Requesting agreement termination for application ${clientRef} with code ${code}`,
  );

  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );

  const agreement = application.getAcceptedAgreement();

  if (!agreement) {
    logger.warn(
      `No active agreement found for application ${clientRef} with code ${code}`,
    );
    return;
  }

  const updateAgreementStatusCommand = new UpdateAgreementStatusCommand({
    clientRef,
    code,
    status: AgreementServiceStatus.Terminated,
    agreementNumber: agreement.agreementRef,
  });

  await insertMany(
    [
      new Outbox({
        event: updateAgreementStatusCommand,
        target: config.sns.updateAgreementStatusTopicArn,
        segregationRef: Outbox.getSegregationRef(updateAgreementStatusCommand),
      }),
    ],
    session,
  );

  logger.info(
    `Finished: Requesting agreement termination for application ${clientRef} with code ${code}`,
  );
};
