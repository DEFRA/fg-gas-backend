import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { logger } from "../../common/logger.js";
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
    action: auditActions.REQUEST_AGREEMENT_TERMINATION,
    entityid: agreementNumber,
    details: {
      clientRef,
      code,
      agreementNumber,
    },
    segregationRef: `request-agreement-termination-${agreementNumber}`,
  });
};

const requestAgreementTermination = async ({ clientRef, code }, session) => {
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
    return undefined;
  }

  const updateAgreementStatusCommand = new UpdateAgreementStatusCommand({
    clientRef,
    code,
    status: AgreementServiceStatus.Terminated,
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

  logger.info(
    `Finished: Requesting agreement termination for application ${clientRef} with code ${code}`,
  );

  return { agreementNumber: agreement.agreementRef };
};

export const requestAgreementTerminationUseCase = withAudit(
  requestAgreementTermination,
  auditDataBuilder,
);
