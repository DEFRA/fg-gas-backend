import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { logger } from "../../common/logger.js";
import { withAuditEvents } from "../../common/with-audit-events.js";
import { Grant } from "../models/grant.js";
import { replace } from "../repositories/grant.repository.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";

const replaceGrant = async (code, replaceGrantCommand) => {
  logger.info(`Replacing grant with code ${code}`);

  await findGrantByCodeUseCase(code);

  const grant = new Grant({
    code,
    metadata: {
      description: replaceGrantCommand.metadata.description,
      startDate: replaceGrantCommand.metadata.startDate,
    },
    actions: replaceGrantCommand.actions,
    phases: replaceGrantCommand.phases,
    externalStatusMap: replaceGrantCommand.externalStatusMap,
  });

  await replace(grant);

  logger.info(`Finished: Replacing grant with code ${code}`);
};

export const replaceGrantUseCase = withAuditEvents(
  replaceGrant,
  ({ args }) => ({
    entities: [
      {
        entity: auditEntities.ENTITY_GRANT,
        action: auditActions.ACTION_REPLACE_GRANT,
        entityid: args[0],
      },
    ],
    details: {},
    messageGroupId: args[0],
  }),
);
