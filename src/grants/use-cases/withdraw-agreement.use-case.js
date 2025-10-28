import { config } from "../../common/config.js";
import { withTransaction } from "../../common/with-transaction.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { CaseStatus } from "../models/case-status.js";
import { Outbox } from "../models/outbox.js";
import { update } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

export const withdrawAgreementUseCase = async ({
  clientRef,
  code,
  agreementRef,
  date,
}) => {
  return withTransaction(async (session) => {
    const application = await findApplicationByClientRefAndCodeUseCase(
      clientRef,
      code,
    );

    const previousStatus = application.getFullyQualifiedStatus();

    application.withdrawAgreement(agreementRef, date);

    await update(application, session);
    const statusEvent = new ApplicationStatusUpdatedEvent({
      clientRef,
      code,
      previousStatus,
      currentStatus: application.getFullyQualifiedStatus(),
    });

    const updateCaseStatusCommand = new UpdateCaseStatusCommand({
      newStatus: CaseStatus.OfferWithdrawn,
      caseRef: clientRef,
      workflowCode: code,
      phase: null,
      stage: null,
      targetNode: "agreements",
      data: application.getAgreementsData(),
    });

    await insertMany(
      [
        new Outbox({
          event: statusEvent,
          target: config.sns.grantApplicationStatusUpdatedTopicArn,
        }),
        new Outbox({
          event: updateCaseStatusCommand,
          target: config.sns.updateCaseStatusTopicArn,
        }),
      ],
      session,
    );
  });
};
