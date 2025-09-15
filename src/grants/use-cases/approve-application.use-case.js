import { applicationStatus } from "../../common/status.js";
import {
  publishApplicationApprovedEvent,
  publishCreateAgreementCommand,
} from "../publishers/application-event.publisher.js";
import {
  findByClientRef,
  update,
} from "../repositories/application.repository.js";

export const approveApplicationUseCase = async (data) => {
  const application = await findByClientRef(data.clientRef);

  // only if the status changes.
  if (application.currentStatus !== applicationStatus.APPROVED) {
    return;
  }

  const { currentStatus: oldStatus, currentPhase, currentStage } = application;

  application.currentStatus = applicationStatus.APPROVED;
  const previousStatus = `${currentPhase}:${currentStage}:${oldStatus}`;
  const currentStatus = `${currentPhase}:${currentStage}:${applicationStatus.APPROVED}`;

  await update(application);

  const applicationApprovedEvent = {
    clientRef: application.clientRef,
    code: application.code,
    previousStatus,
    currentStatus,
  };

  // publish application approved event
  await publishApplicationApprovedEvent(applicationApprovedEvent);

  // publish generate agreement event
  await publishCreateAgreementCommand(application);
};
