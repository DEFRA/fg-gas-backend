import Boom from "@hapi/boom";
import { ApplicationStatus } from "../../common/application-status.js";
import {
  publishApplicationApprovedEvent,
  publishCreateAgreementCommand,
} from "../publishers/application-event.publisher.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";

export const approveApplicationUseCase = async (data) => {
  const { caseRef, workflowCode } = data;
  const application = await findByClientRefAndCode(caseRef, workflowCode);

  if (!application) {
    throw Boom.notFound(
      `Application with clientRef "${data.caseRef}" and code "${workflowCode}" not found`,
    );
  }

  // update only if the status changes.
  if (application.currentStatus === ApplicationStatus.Approved) {
    return;
  }

  const {
    currentStatus: oldStatus,
    currentPhase,
    currentStage,
    code,
    clientRef,
  } = application;

  application.setCurrentStatus(ApplicationStatus.Approved);

  const previousStatus = `${currentPhase}:${currentStage}:${oldStatus}`;
  const currentStatus = `${currentPhase}:${currentStage}:${ApplicationStatus.Approved}`;

  await update(application);

  const applicationApprovedEvent = {
    clientRef,
    code,
    previousStatus,
    currentStatus,
  };

  // publish application approved event
  await publishApplicationApprovedEvent(applicationApprovedEvent);

  // publish generate agreement event
  await publishCreateAgreementCommand(application);
};
