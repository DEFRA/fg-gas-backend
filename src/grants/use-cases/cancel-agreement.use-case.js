import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { withAuditEvents } from "../../common/with-audit-events.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { createAgreementCaseUpdateOutbox } from "./agreement-case-update.helpers.js";

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

export const cancelAgreementUseCase = withAuditEvents(
  cancelAgreement,
  ({ args }) => ({
    entities: [
      {
        entity: auditEntities.ENTITY_AGREEMENT,
        action: auditActions.ACTION_CANCEL_AGREEMENT,
        entityid: args[0].clientRef,
      },
    ],
    details: { code: args[0].code },
    messageGroupId: `${args[0].clientRef}-${args[0].code}`,
    session: args[1],
  }),
);
