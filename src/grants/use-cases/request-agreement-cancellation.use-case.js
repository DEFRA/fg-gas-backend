import { AgreementServiceStatus } from "../models/agreement.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { updateAgreementStatusCommandPublication } from "./agreement-command-publication.js";

export const requestAgreementCancellationUseCase = async (command, session) => {
  const { clientRef, code } = command;
  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const agreement = application?.getActiveAgreement();

  if (!agreement) {
    return;
  }

  await insertMany(
    [
      updateAgreementStatusCommandPublication({
        clientRef,
        code,
        status: AgreementServiceStatus.Cancelled,
        agreementNumber: agreement.agreementRef,
      }),
    ],
    session,
  );
};
