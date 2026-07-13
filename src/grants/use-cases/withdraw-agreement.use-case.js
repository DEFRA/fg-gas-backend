import { auditActions, auditEntities } from "../../common/audit-constants.js";
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
    action: auditActions.WITHDRAW_AGREEMENT,
    entityid: eventData.agreementNumber,
    details: {
      clientRef,
      code,
      eventData,
    },
    messageGroupId: `withdraw-agreement-${eventData.agreementNumber}`,
  });
};

const withdrawAgreement = async (command, session) => {
  const { clientRef, code, eventData } = command;
  const { agreementNumber } = eventData;
  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const agreement = application.getAgreement(agreementNumber);

  agreement.withdraw(new Date().toISOString());

  await update(application, session);

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
};

export const withdrawAgreementUseCase = withAudit(
  withdrawAgreement,
  auditDataBuilder,
);
