import Boom from "@hapi/boom";
import { agreementStatusMap } from "../../common/application-status.js";
import {
  publishApplicationStatusUpdated,
  publishUpdateApplicationStatusCommand,
} from "../publishers/application-event.publisher.js";
import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefUseCase } from "./find-application-by-client-ref.use-case.js";

export const updateApplicationStatusUseCase = async (messageData) => {
  const {
    clientRef,
    status: agreementStatus,
    agreementNumber: agreementRef,
    date,
    correlationId,
  } = messageData;
  const application = await findApplicationByClientRefUseCase(clientRef);
  const { status, code } = application;

  const createdAt = new Date(date).toISOString();
  const agreementData = {
    createdAt,
    agreementStatus,
    agreementRef,
    correlationId,
  };

  const oldStatus = agreementStatusMap[status];
  const newStatus = agreementStatusMap[agreementStatus];

  if (!newStatus) {
    throw Boom.badRequest(
      `Can not update agreement "${agreementRef}" with status "${newStatus}" from agreementStatus "${agreementStatus}"`,
    );
  }

  application.updateStatus(newStatus);
  application.storeAgreement(agreementData);
  await update(application);

  // Publish events/commands
  // publish event to wider audience
  await publishApplicationStatusUpdated({
    clientRef,
    oldStatus,
    newStatus,
  });

  // publish command to case working
  await publishUpdateApplicationStatusCommand({
    clientRef,
    code,
    agreementData,
  });
};
