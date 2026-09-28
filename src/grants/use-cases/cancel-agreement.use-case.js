import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { saveEvents } from "../../events/index.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { createAgreementCaseUpdatePublication } from "./agreement-case-update.helpers.js";

export const auditDataBuilder = (args) => {
  const { clientRef, code, eventData } = args[0];
  return buildAuditEvent({
    entity: auditEntities.AGREEMENT,
    action: auditActions.CANCEL_AGREEMENT,
    entityid: eventData.agreementNumber,
    details: {
      clientRef,
      code,
      eventData,
    },
    segregationRef: `cancel-agreement-${eventData.agreementNumber}`,
  });
};

const cancelAgreement = async (command, session) => {
  const { clientRef, code, eventData } = command;
  const { agreementNumber, date } = eventData;
  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );

  application.cancelAgreement(agreementNumber, date);

  await update(application, session);

  await saveEvents(
    [
      createAgreementCaseUpdatePublication({
        clientRef,
        code,
        application,
        agreementNumber,
      }),
    ],
    session,
  );
};

export const cancelAgreementUseCase = withAudit(
  cancelAgreement,
  auditDataBuilder,
);
