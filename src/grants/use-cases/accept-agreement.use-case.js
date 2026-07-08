import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { createAgreementCaseUpdateOutbox } from "./agreement-case-update.helpers.js";

export const auditDataBuilder = (args) => {
  const { clientRef, code, eventData } = args[0];
  return buildAuditEvent({
    entity: auditEntities.AGREEMENT,
    action: auditActions.ACCEPT_AGREEMENT,
    entityid: eventData.agreementNumber,
    details: {
      clientRef,
      code,
      eventData,
    },
    messageGroupId: `accept-agreement-${eventData.agreementNumber}`,
  });
};

const acceptAgreement = async (command, session) => {
  const { clientRef, code, eventData } = command;
  const { agreementNumber, date: acceptedDate, startDate, endDate } = eventData;

  logger.info(
    `Accepting agreement ${agreementNumber} for application ${clientRef} with code ${code}`,
  );

  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );

  const previousStatus = application.getFullyQualifiedStatus();

  const agreementDates = {
    acceptedDate,
    startDate,
    endDate,
  };

  application.acceptAgreement(agreementNumber, agreementDates);

  await update(application, session);

  logger.debug(
    `Application ${clientRef} status updated from ${previousStatus} to ${application.getFullyQualifiedStatus()}`,
  );

  await insertMany(
    [
      createAgreementCaseUpdateOutbox({
        clientRef,
        code,
        application,
        agreementNumber,
      }),
    ],
    session,
  );
  logger.info(
    `Finished: Accepting agreement ${agreementNumber} for application ${clientRef} with code ${code}`,
  );
};

export const acceptAgreementUseCase = withAudit(
  acceptAgreement,
  auditDataBuilder,
);
