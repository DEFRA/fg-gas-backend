import { logger } from "../../common/logger.js";
import { AgreementServiceStatus } from "../models/agreement.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { updateAgreementStatusCommandPublication } from "./agreement-command-publication.js";

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

  await insertMany(
    [
      updateAgreementStatusCommandPublication({
        clientRef,
        code,
        status: AgreementServiceStatus.Terminated,
        agreementNumber: agreement.agreementRef,
      }),
    ],
    session,
  );

  logger.info(
    `Finished: Requesting agreement termination for application ${clientRef} with code ${code}`,
  );
};
