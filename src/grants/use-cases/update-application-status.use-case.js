import Boom from "@hapi/boom";
import { applicationStatus } from "../../common/application-status.js";
import {
  publishApplicationStatusUpdated,
  publishUpdateApplicationStatusCommand,
} from "../publishers/application-event.publisher.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";

export const updateApplicationStatusUseCase = async (messageData) => {
  const {
    clientRef,
    status: agreementStatus,
    agreementNumber: agreementRef,
    code,
    date,
    correlationId,
  } = messageData;
  const application = await findByClientRefAndCode({ clientRef, code });
  const { status: oldStatus } = application;

  const createdAt = new Date(date).toISOString();
  const agreementData = {
    createdAt,
    agreementStatus,
    agreementRef,
    correlationId,
  };

  const newStatus = applicationStatus[agreementStatus];

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
