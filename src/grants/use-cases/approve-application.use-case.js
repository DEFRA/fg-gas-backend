import {
  publishApplicationApproved,
  publishGenerateAgreement,
} from "../publishers/application-event.publisher.js";
import { findApplicationByClientRefUseCase } from "./find-application-by-client-ref.use-case.js";
import { updateApplicationUseCase } from "./update-application.use-case.js";

export const approveApplicationUseCase = async (data) => {
  const application = await findApplicationByClientRefUseCase(data.clientRef);

  // update application status to approved from received status
  application.currentStatus = "APPROVED"; // We need a enum for these values once we understand all possible values
  await updateApplicationUseCase(application);

  const applicationApproved = {
    clientRef: application.clientRef,
    previousStatus:
      application.currentPhase +
      ":" +
      application.currentStage +
      ":" +
      "RECEIVED", // We need a enum for these values once we understand all possible values
    currentStatus:
      application.currentPhase +
      ":" +
      application.currentStage +
      ":" +
      "APPROVED", // We need a enum for these values once we understand all possible values
  };

  // publish application approved event
  await publishApplicationApproved(applicationApproved);

  // publish generate agreement event
  await publishGenerateAgreement(application);
};
