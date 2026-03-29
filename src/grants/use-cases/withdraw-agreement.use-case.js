import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { createAgreementCaseUpdateOutbox } from "./agreement-case-update.helpers.js";

export const withdrawAgreementUseCase = async (command, session) => {
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
