import { config } from "../../common/config.js";
import { withTransaction } from "../../common/with-transaction.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { Outbox } from "../models/outbox.js";
import { update } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

export const withdrawAgreementUseCase = async ({
  clientRef,
  code,
  agreementRef,
  date,
  source,
  requestedStatus,
}) => {
  return withTransaction(async (session) => {
    const application = await findApplicationByClientRefAndCodeUseCase(
      clientRef,
      code,
    );

    const previousStatus = application.getFullyQualifiedStatus();

    await applyExternalStateChange({
      sourceSystem: source,
      clientRef,
      code,
      externalRequestedState: requestedStatus,
    });

    application.withdrawAgreement(agreementRef, date);

    await update(application, session);
    const statusEvent = new ApplicationStatusUpdatedEvent({
      clientRef,
      code,
      previousStatus,
      currentStatus: application.getFullyQualifiedStatus(),
    });

    await insertMany(
      [
        new Outbox({
          event: statusEvent,
          target: config.sns.grantApplicationStatusUpdatedTopicArn,
        }),
      ],
      session,
    );
  });
};
