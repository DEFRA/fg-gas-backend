import Boom from "@hapi/boom";
import { ApplicationStatus } from "../../common/application-status.js";
import {
  publishApplicationApproved,
  publishCreateAgreementCommand,
} from "../publishers/application-event.publisher.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";

export const approveApplicationUseCase = async (data) => {
  const { caseRef, workflowCode } = data;
  const application = await findByClientRefAndCode({
    clientRef: caseRef,
    code: workflowCode,
  });

  if (!application) {
    throw Boom.notFound(
      `Application with clientRef "${caseRef}" and code "${workflowCode}" not found`,
    );
  }

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

  application.currentStatus = ApplicationStatus.Approved;
  const previousStatus = `${currentPhase}:${currentStage}:${oldStatus}`;
  const currentStatus = `${currentPhase}:${currentStage}:${ApplicationStatus.Approved}`;

  await update(application);

  const applicationApprovedEventData = {
    clientRef,
    code,
    previousStatus,
    currentStatus,
  };

  await publishApplicationApproved(applicationApprovedEventData);
  await publishCreateAgreementCommand(application);
};
