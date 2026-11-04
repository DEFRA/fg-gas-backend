import { revokeApiToken } from "../../auth/services/api-client.service.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  PMC_0705_SECURITY,
  auditActions,
} from "../../events/audit-constants.js";
import { withAudit } from "../../events/with-audit.js";
import { revokeCwApiToken } from "../repositories/cw-clients.repository.js";
import { GAS } from "../services/event-sources.js";
import { buildApiClientAudit } from "./api-client-audit.js";

// Caseworking refuses the token GAS calls it with, as GAS refuses the
// admin's, so no caller hash is sent.
const revokeOn = (params, session) =>
  params.service === GAS
    ? revokeApiToken(
        {
          clientId: params.clientId,
          tokenId: params.tokenId,
          callerHash: params.callerHash,
          by: params.actor,
        },
        session,
      )
    : revokeCwApiToken(params.clientId, params.tokenId, {
        actor: params.encodedActor,
      });

const revoke = async (params, session) => {
  const label = `${params.service}/${params.clientId}/${params.tokenId}`;

  logger.info(`Revoke API token ${label}`);
  await revokeOn(params, session);
  logger.info(`Finished: Revoke API token ${label}`);
};

const buildAudit = buildApiClientAudit(
  auditActions.REVOKE_API_TOKEN,
  PMC_0705_SECURITY,
);

export const buildRevokeApiTokenAudit = ([params], result, error) =>
  buildAudit(params, result, error);

const revokeWithAudit = withAudit(revoke, buildRevokeApiTokenAudit);

export const revokeApiTokenUseCase = (params) =>
  params.service === GAS
    ? withTransaction((session) => revokeWithAudit(params, session))
    : revokeWithAudit(params);
