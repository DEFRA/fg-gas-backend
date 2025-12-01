import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { Outbox } from "../models/outbox.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

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
  const createAgreementCommand = new CreateAgreementCommand(application);
  await insertMany(
    [
      new Outbox({
        event: createAgreementCommand,
        target: config.sns.createAgreementTopicArn,
      }),
    ],
    session,
  );

  logger.info(
    `Finished: Creating agreement for application ${clientRef} with code ${code}`,
  );
};
