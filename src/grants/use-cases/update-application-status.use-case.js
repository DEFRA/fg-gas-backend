import Boom from "@hapi/boom";
import { agreementStatusMap, applicationStatus } from "../../common/application-status.js";
import {
  publishApplicationStatusUpdated,
  publishUpdateApplicationStatusCommand,
} from "../publishers/application-event.publisher.js";
import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefUseCase } from "./find-application-by-client-ref.use-case.js";

/* Data sent by agreement service on the application status update event...
 {
     "agreementNumber": "SFI123456789",
     "correlationId": "test-correlation-id",
     "clientRef": "test-client-ref",
     "status": "offered",
     "date": "2025-01-01T00:00:00.000Z"
  }
*/
export const updateApplicationStatusUseCase = async (messageData) => {
  const { clientRef, status: agreementStatus, agreementNumber: agreementRef, date, correlationId } = messageData;
  const application = await findApplicationByClientRefUseCase(clientRef);
  const { status, code } = application;

  const createdAt = new Date(date).toISOString();
  const agreementData = {
    createdAt,
    agreementStatus,
    agreementRef,
    correlationId,
  };

  console.log("updateApplicationStatusUseCase", {agreementData})

  const oldStatus = agreementStatusMap[status];
  const newStatus = agreementStatusMap[agreementStatus];

  console.log({oldStatus, newStatus});

  if(!newStatus) {
    throw Boom.badRequest(`Can not update agreement "${agreementRef}" with status "${newStatus}"`)
  }

  application.updateStatus(applicationStatus[agreementStatus]);
  application.storeAgreement(agreementData);
  await update(application);

  // Publish events/commands
  await publishApplicationStatusUpdated({
    clientRef,
    oldStatus,
    newStatus,
  }); // publish event to wider audience

  await publishUpdateApplicationStatusCommand({
    clientRef,
    code,
    agreementData
  }); // publish command to case working
};
