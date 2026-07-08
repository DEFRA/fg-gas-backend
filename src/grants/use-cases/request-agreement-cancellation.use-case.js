import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { config } from "../../common/config.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import { UpdateAgreementStatusCommand } from "../events/update-agreement-status.command.js";
import { AgreementServiceStatus } from "../models/agreement.js";
import { Outbox } from "../models/outbox.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const auditDataBuilder = (args, result) => {
  const { clientRef, code } = args[0];
  const agreementNumber = result?.agreementNumber;

  if (!agreementNumber) {
    return null;
  }

  return buildAuditEvent({
    entity: auditEntities.AGREEMENT,
    action: auditActions.REQUEST_AGREEMENT_CANCELLATION,
    entityid: agreementNumber,
    details: {
      clientRef,
      code,
      agreementNumber,
    },
    messageGroupId: `request-agreement-cancellation-${agreementNumber}`,
  });
};

const requestAgreementCancellation = async (command, session) => {
  const { clientRef, code } = command;
  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const agreement = application?.getActiveAgreement();

  if (!agreement) {
    return undefined;
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

  return { agreementNumber: agreement.agreementRef };
};

export const requestAgreementCancellationUseCase = withAudit(
  requestAgreementCancellation,
  auditDataBuilder,
);
