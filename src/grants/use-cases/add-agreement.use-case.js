import { config } from "../../common/config.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { Agreement } from "../models/agreement.js";
import { Application } from "../models/application.js";
import { Outbox } from "../models/outbox.js";
import { update } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const addAgreementUseCase = async (command, session) => {
  const { application: app, clientRef, code, eventData } = command;
  const { currentStatus, currentPhase, currentStage } = app;
  const { agreementNumber, date } = eventData;
  const application = Application.new(app);

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
    data: eventData,
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
