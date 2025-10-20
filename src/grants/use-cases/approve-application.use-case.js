import {
  publishApplicationStatusUpdated,
  publishCreateAgreementCommand,
} from "../publishers/application-event.publisher.js";
import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

export const approveApplicationUseCase = async ({ clientRef, code }) => {
  const application = await findApplicationByClientRefAndCodeUseCase(
    clientRef,
    code,
  );

  const previousStatus = application.getFullyQualifiedStatus();

  application.approve();

  await update(application);

  await publishApplicationStatusUpdated({
    clientRef,
    code,
    previousStatus,
    currentStatus: application.getFullyQualifiedStatus(),
  });

  await publishCreateAgreementCommand(application);
};
