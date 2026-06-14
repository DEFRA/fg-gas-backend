import { logger } from "../../common/logger.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { createAgreementCommandPublication } from "./agreement-command-publication.js";

export const createAgreementCommandUseCase = async (
  { clientRef, code },
  session,
) => {
  logger.info(
    `Creating agreement for application ${clientRef} with code ${code}`,
  );

  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  await insertMany([createAgreementCommandPublication(application)], session);

  logger.info(
    `Finished: Creating agreement for application ${clientRef} with code ${code}`,
  );
};
