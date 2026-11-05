import { rotateApiToken } from "../../auth/services/api-client.service.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  PMC_0705_SECURITY,
  auditActions,
} from "../../events/audit-constants.js";
import { withAudit } from "../../events/with-audit.js";
import { rotateCwApiToken } from "../repositories/cw-clients.repository.js";
import { GAS } from "../services/event-sources.js";
import { buildApiClientAudit, expiryOf } from "./api-client-audit.js";

// Caseworking answers when the old token now stops, for this audit as for its
// own.
const rotateOnCw = (params) =>
  rotateCwApiToken(
    params.clientId,
    params.tokenId,
    {
      tokenHash: params.tokenHash,
      tokenHint: params.tokenHint,
      keepOld: params.keepOld,
    },
    { actor: params.encodedActor },
  );

const rotateOn = (params, session) =>
  params.service === GAS
    ? rotateApiToken(
        {
          clientId: params.clientId,
          tokenId: params.tokenId,
          callerHash: params.callerHash,
          tokenHash: params.tokenHash,
          tokenHint: params.tokenHint,
          keepOld: params.keepOld,
          by: params.actor,
        },
        session,
      )
    : rotateOnCw(params);

const rotate = async (params, session) => {
  const label = `${params.service}/${params.clientId}/${params.tokenId}`;

  logger.info(`Rotate API token ${label}`);
  const result = await rotateOn(params, session);
  logger.info(`Finished: Rotate API token ${label}`);

  return { service: params.service, ...result };
};

const rotationOf = ({ keepOld }, result) => ({
  keepOld,
  newTokenId: result?.token?.tokenId,
  oldExpiresAt: expiryOf(result?.oldExpiresAt),
});

const buildAudit = buildApiClientAudit(
  auditActions.ROTATE_API_TOKEN,
  PMC_0705_SECURITY,
  rotationOf,
);

export const buildRotateApiTokenAudit = ([params], result, error) =>
  buildAudit(params, result, error);

const rotateWithAudit = withAudit(rotate, buildRotateApiTokenAudit);

// GAS: both rows and the audit event commit together, or none of them do.
export const rotateApiTokenUseCase = (params) =>
  params.service === GAS
    ? withTransaction((session) => rotateWithAudit(params, session))
    : rotateWithAudit(params);
