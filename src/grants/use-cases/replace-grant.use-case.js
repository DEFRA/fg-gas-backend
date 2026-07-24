import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import { Grant } from "../models/grant.js";
import { findByCode, replace } from "../repositories/grant.repository.js";

export const replaceGrantAuditBuilder = ([{ code, command }]) =>
  buildAuditEvent({
    entity: auditEntities.GRANT,
    action: auditActions.REPLACE_GRANT,
    entityid: code,
    details: { newGrantCommand: command },
    messageGroupId: `replace-grant-${code}`,
  });

export const replaceGrant = async ({ code, command }) => {
  logger.info(`Replacing grant with code ${code}`);

  const version = command.version ?? "0.0.0";
  const existing = await findByCode(code, version);
  if (!existing) {
    throw Boom.notFound(
      `Grant with code "${code}" version "${version}" not found`,
    );
  }

  const grant = new Grant({
    code,
    version,
    metadata: {
      description: command.metadata.description,
      startDate: command.metadata.startDate,
    },
    actions: command.actions,
    phases: command.phases,
    externalStatusMap: command.externalStatusMap,
  });

  await replace(grant);

  logger.info(`Finished: Replacing grant with code ${code}`);
};

export const replaceGrantUseCase = withAudit(
  replaceGrant,
  replaceGrantAuditBuilder,
);
