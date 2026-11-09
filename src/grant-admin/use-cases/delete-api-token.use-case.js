import { deleteApiToken } from "../../auth/services/api-client.service.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  PMC_0705_SECURITY,
  auditActions,
} from "../../events/audit-constants.js";
import { withAudit } from "../../events/with-audit.js";
import { deleteCwApiToken } from "../repositories/cw-clients.repository.js";
import { GAS } from "../services/event-sources.js";
import { buildApiClientAudit } from "./api-client-audit.js";

const deleteOn = (params, session) =>
  params.service === GAS
    ? deleteApiToken(
        { clientId: params.clientId, tokenId: params.tokenId },
        session,
      )
    : deleteCwApiToken(params.clientId, params.tokenId, {
        actor: params.encodedActor,
      });

const deleteToken = async (params, session) => {
  const label = `${params.service}/${params.clientId}/${params.tokenId}`;

  logger.info(`Delete API token ${label}`);
  await deleteOn(params, session);
  logger.info(`Finished: Delete API token ${label}`);
};

const buildAudit = buildApiClientAudit(
  auditActions.DELETE_API_TOKEN,
  PMC_0705_SECURITY,
);

export const buildDeleteApiTokenAudit = ([params], result, error) =>
  buildAudit(params, result, error);

const deleteWithAudit = withAudit(deleteToken, buildDeleteApiTokenAudit);

// GAS: the row goes and the audit event commits with it.
export const deleteApiTokenUseCase = (params) =>
  params.service === GAS
    ? withTransaction((session) => deleteWithAudit(params, session))
    : deleteWithAudit(params);
