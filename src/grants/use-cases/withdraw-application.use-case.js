import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { config } from "../../common/config.js";
import { saveEvents } from "../../events/index.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { ApplicationStatusUpdatedEvent } from "../events/application-status-updated.event.js";
import { UpdateAgreementStatusCommand } from "../events/update-agreement-status.command.js";
import { AgreementServiceStatus } from "../models/agreement.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { resolveAgreementStatusCommandTarget } from "./agreement-status-command.helpers.js";

export const auditDataBuilder = (args) => {
  const { clientRef, code } = args[0];
  return buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.WITHDRAW_APPLICATION,
    entityid: clientRef,
    details: {
      clientRef,
      code,
    },
    segregationRef: `withdraw-application-${clientRef}`,
  });
};

const withdrawApplication = async (command, session) => {
  const { clientRef, code } = command;
  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const { currentStage, currentPhase } = application;
  const agreement = application.getActiveAgreement();

  const publications = [];

  if (agreement) {
    // create a withdraw agreement command for Agreement Service
    const updateAgreementStatusCommand = new UpdateAgreementStatusCommand({
      clientRef,
      code,
      status: AgreementServiceStatus.Withdrawn,
      agreementNumber: agreement.agreementRef,
    });

    publications.push({
      event: updateAgreementStatusCommand,
      target: await resolveAgreementStatusCommandTarget(
        updateAgreementStatusCommand,
      ),
    });
  } else {
    // if we have no agreement we withdraw the application and notify Case Working...
    const statusBeforeUpdate = application.getFullyQualifiedStatus();

    application.withdraw();
    await update(application, session);

    const statusCommand = new UpdateCaseStatusCommand({
      caseRef: clientRef,
      workflowCode: code,
      configVersion: application.currentConfigVersion,
      newStatus: application.getFullyQualifiedStatus(),
      phase: currentPhase,
      stage: currentStage,
    });

    publications.push({
      event: statusCommand,
      target: config.sns.updateCaseStatusTopicArn,
    });

    const statusEvent = new ApplicationStatusUpdatedEvent({
      clientRef,
      code,
      currentConfigVersion: application.currentConfigVersion,
      previousStatus: statusBeforeUpdate,
      currentStatus: application.getFullyQualifiedStatus(),
    });

    publications.push({
      event: statusEvent,
      target: config.sns.grantApplicationStatusUpdatedTopicArn,
    });
  }

  await saveEvents(publications, session);
};

export const withdrawApplicationUseCase = withAudit(
  withdrawApplication,
  auditDataBuilder,
);
