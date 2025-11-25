import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { Agreement } from "../models/agreement.js";
import { Outbox } from "../models/outbox.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const addAgreementUseCase = async (command, session) => {
  const { clientRef, code, eventData } = command;
  const { agreementNumber, date } = eventData;

  logger.debug(
    `Adding agreement ${agreementNumber} for application ${clientRef} with code ${code} on ${date}`,
  );

  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const { currentPhase, currentStage } = application;

  const agreement = Agreement.new({
    agreementRef: agreementNumber,
    date,
  });

  // store the agreement on the application
  application.addAgreement(agreement);
  await update(application, session);

  logger.debug(
    `Application updated with agreement for ${clientRef} with code ${code}`,
  );

  const agreementData = application
    .getAgreementsData()
    .find((a) => a.agreementRef === agreementNumber);

  const statusCommand = new UpdateCaseStatusCommand({
    caseRef: clientRef,
    workflowCode: code,
    newStatus: application.getFullyQualifiedStatus(),
    phase: currentPhase,
    stage: currentStage,
    targetNode: "agreements",
    dataType: "ARRAY",
    key: "agreementRef",
    data: agreementData,
  });

  await insertMany(
    [
      new Outbox({
        event: statusCommand,
        target: config.sns.updateCaseStatusTopicArn,
      }),
    ],
    session,
  );

  logger.debug(
    `Finished: Adding agreement ${agreementNumber} for application ${clientRef} with code ${code}`,
  );
};
