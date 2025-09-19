import Boom from "@hapi/boom";
import { ApplicationStatus } from "../models/application.js";
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

  const { code, clientRef } = application;

  const oldStatus = application.getFullyQualifiedStatus();

  application.approve();

  const newStatus = application.getFullyQualifiedStatus();

  await update(application);

  const applicationApprovedEventData = {
    clientRef,
    code,
    oldStatus,
    newStatus,
  };

  await publishApplicationApproved(applicationApprovedEventData);
  await publishCreateAgreementCommand(application);
};
