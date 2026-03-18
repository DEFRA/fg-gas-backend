import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import {
  createAgreementCaseUpdateOutbox,
  createApplicationStatusUpdatedOutbox,
} from "./agreement-case-update.helpers.js";

export const cancelAgreementUseCase = async (command, session) => {
  const { clientRef, code, eventData } = command;
  const { agreementNumber, date } = eventData;
  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const prevApplication = await findByClientRefAndCode({ clientRef, code });
  const previousStatus = prevApplication.getFullyQualifiedStatus();

  application.cancelAgreement(agreementNumber, date);

  await update(application, session);

  await insertMany(
    [
      createApplicationStatusUpdatedOutbox({
        clientRef,
        code,
        previousStatus,
        application,
      }),
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
