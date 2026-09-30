import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { saveEvents } from "../../events/index.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { UpdateAgreementStatusCommand } from "../events/update-agreement-status.command.js";
import { AgreementServiceStatus } from "../models/agreement.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { resolveAgreementStatusCommandTarget } from "./agreement-status-command.helpers.js";

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
    segregationRef: `request-agreement-cancellation-${agreementNumber}`,
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

  await saveEvents(
    [
      {
        event: updateAgreementStatusCommand,
        target: await resolveAgreementStatusCommandTarget(
          updateAgreementStatusCommand,
        ),
      },
    ],
    session,
  );

  return { agreementNumber: agreement.agreementRef };
};

export const requestAgreementCancellationUseCase = withAudit(
  requestAgreementCancellation,
  auditDataBuilder,
);
