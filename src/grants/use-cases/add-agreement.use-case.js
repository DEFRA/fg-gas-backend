import { config } from "../../common/config.js";
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

  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const { currentStatus, currentPhase, currentStage } = application;

  const agreement = Agreement.new({
    agreementRef: agreementNumber,
    date,
  });

  // store the agreement on the application
  application.addAgreement(agreement);
  await update(application, session);

  const statusCommand = new UpdateCaseStatusCommand({
    caseRef: clientRef,
    workflowCode: code,
    newStatus: currentStatus,
    phase: currentPhase,
    stage: currentStage,
    targetNode: "agreements",
    data: application.getAgreementsData(),
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
};
