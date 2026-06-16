import {
  auditActions,
  auditEntities,
  buildAuditEvent,
} from "../../common/audit-constants.js";
import { withAudit } from "../../common/with-audit.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { createAgreementCaseUpdateOutbox } from "./agreement-case-update.helpers.js";

const buildCancelAgreementAuditEvent = ({
  entityid,
  details,
  messageGroupId,
}) =>
  buildAuditEvent({
    entity: auditEntities.AGREEMENT,
    action: auditActions.CANCEL_AGREEMENT,
    entityid,
    details,
    messageGroupId,
  });

const cancelAgreement = async (command, session) => {
  const { clientRef, code, eventData } = command;
  const { agreementNumber, date } = eventData;
  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );

  application.cancelAgreement(agreementNumber, date);

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

export const cancelAgreementUseCase = withAudit({
  run: cancelAgreement,
  getSession: ({ args }) => args[1],
  audit: ({ args }) => {
    const { clientRef, code } = args[0];
    return buildCancelAgreementAuditEvent({
      entityid: clientRef,
      details: { code },
      messageGroupId: `${clientRef}-${code}`,
    });
  },
});
