import { config } from "../../common/config.js";
import { UpdateAgreementStatusCommand } from "../events/update-agreement-status.command.js";
import { AgreementServiceStatus } from "../models/agreement.js";
import { Outbox } from "../models/outbox.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const requestAgreementCancellationUseCase = async (command, session) => {
  const { clientRef, code } = command;
  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const agreement = application?.getActiveAgreement();

  if (!agreement) {
    return;
  }

  const updateAgreementStatusCommand = new UpdateAgreementStatusCommand({
    clientRef,
    code,
    status: AgreementServiceStatus.Cancelled,
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
};
