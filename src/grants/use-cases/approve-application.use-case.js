/**eslint disable import-x/no-restricted-paths**/
 import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import { withTransaction } from "../../common/mongo-client.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { EventPublication } from "../models/event-publication.js";
import { config } from "../../common/config.js";
import { insert } from "../repositories/event-publication.respository.js";


export const approveApplicationUseCase = async ({ clientRef, code }) => {
  return await withTransaction(async (session) => {
    const application = await findApplicationByClientRefAndCodeUseCase(
      clientRef,
      code,
      session
    );

    const previousStatus = application.getFullyQualifiedStatus();
    application.approve();

    await update(application, { session });

    const event = new ApplicationStatusUpdatedEvent({clientRef, code, previousStatus, currentStatus: application.getFullyQualifiedStatus()});

    const eventPublication = new EventPublication({
      event,
      listenerId: config.sns.grantApplicationStatusUpdatedTopicArn,
    });

    await insert(eventPublication);

    return { application }
  });
};
