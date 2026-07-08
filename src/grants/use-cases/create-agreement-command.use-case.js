import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import { CreateAgreementCommand } from "../events/create-agreement.command.js";
import { Outbox } from "../models/outbox.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";

export const auditDataBuilder = (args) => {
  const { clientRef, code } = args[0];
  return buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.CREATE_AGREEMENT,
    entityid: clientRef,
    details: {
      clientRef,
      code,
    },
    messageGroupId: `create-agreement-${clientRef}`,
  });
};

const createAgreementCommand = async ({ clientRef, code }, session) => {
  logger.info(
    `Creating agreement for application ${clientRef} with code ${code}`,
  );

  const application = await findByClientRefAndCode(
    { clientRef, code },
    session,
  );
  const createAgreementCommand = new CreateAgreementCommand(application);
  await insertMany(
    [
      new Outbox({
        event: createAgreementCommand,
        target: config.sns.createAgreementTopicArn,
        segregationRef: Outbox.getSegregationRef(createAgreementCommand),
      }),
    ],
    session,
  );

  logger.info(
    `Finished: Creating agreement for application ${clientRef} with code ${code}`,
  );
};

export const createAgreementCommandUseCase = withAudit(
  createAgreementCommand,
  auditDataBuilder,
);
