import {
  publishApplicationStatusUpdated,
  publishUpdateApplicationStatusCommand,
} from "../publishers/application-event.publisher.js";
import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefUseCase } from "./find-application-by-client-ref.use-case.js";

export const updateApplicationStatusUseCase = async (messageData) => {
  const { clientRef, agreementStatus, agreementRef } = messageData;
  const application = await findApplicationByClientRefUseCase(clientRef);

  const createdAt = new Date().toISOString();
  const agreementData = {
    createdAt,
    agreementStatus,
    agreementRef,
  };

  application.updateStatus(agreementStatus);
  application.storeAgreement(agreementData);

  await update(application);

  await publishApplicationStatusUpdated(application); // publish to wider audience

  await publishUpdateApplicationStatusCommand(application, agreementData); // publish to case working
};
