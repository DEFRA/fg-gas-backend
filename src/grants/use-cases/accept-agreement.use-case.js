import { logger } from "../../common/logger.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { createAgreementCaseUpdateOutbox } from "./agreement-case-update.helpers.js";

export const acceptAgreementUseCase = async (command, session) => {
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
