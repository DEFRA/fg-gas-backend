import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { createAgreementCaseUpdateOutbox } from "./agreement-case-update.helpers.js";

export const cancelAgreementUseCase = async (command, session) => {
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
