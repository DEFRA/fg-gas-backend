import {
  assertExpiryChange,
  changeApiTokenExpiry,
} from "../../auth/services/api-client.service.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  PMC_0705_SECURITY,
  auditActions,
} from "../../events/audit-constants.js";
import { withAudit } from "../../events/with-audit.js";
import { changeCwApiTokenExpiry } from "../repositories/cw-clients.repository.js";
import { GAS } from "../services/event-sources.js";
import { buildApiClientAudit, expiryOf } from "./api-client-audit.js";
import {
  answeringTokens,
  readTokensOrNull,
  refusalWithTokens,
} from "./api-token-answers.js";

const TOKEN_ACTIVE = "ACTIVE";

// Caseworking's expiry is checked against its list as GAS checks its own, and
// a refusal carries that list.
const assertCwExpiryChange = async (params) => {
  const tokens = await readTokensOrNull(params);
  const token = tokens?.find(({ tokenId }) => tokenId === params.tokenId);

  try {
    if (token) {
      assertExpiryChange({
        expiresAt: params.expiresAt,
        stored: token.expiresAt,
        active: token.status === TOKEN_ACTIVE,
        now: new Date(),
      });
    }
  } catch (error) {
    throw await refusalWithTokens(error, params, tokens);
  }
};

// Caseworking answers what it replaced, for this audit as for its own.
const changeOnCw = async (params) => {
  await assertCwExpiryChange(params);

  return changeCwApiTokenExpiry(
    params.clientId,
    params.tokenId,
    { expiresAt: params.expiresAt },
    { actor: params.encodedActor },
  );
};

const changeOn = (params, session) =>
  params.service === GAS
    ? changeApiTokenExpiry(
        {
          clientId: params.clientId,
          tokenId: params.tokenId,
          callerHash: params.callerHash,
          expiresAt: params.expiresAt,
        },
        session,
      )
    : changeOnCw(params);

const changeExpiry = async (params, session) => {
  const label = `${params.service}/${params.clientId}/${params.tokenId}`;

  logger.info(`Change API token expiry ${label}`);
  const result = await changeOn(params, session);
  logger.info(`Finished: Change API token expiry ${label}`);

  return { service: params.service, ...result };
};

const changeOf = ({ expiresAt }, result) => ({
  expiresAt: expiryOf(expiresAt),
  previousExpiresAt: expiryOf(result?.previousExpiresAt),
  revived: result?.revived,
});

const buildAudit = buildApiClientAudit(
  auditActions.CHANGE_API_TOKEN_EXPIRY,
  PMC_0705_SECURITY,
  changeOf,
);

export const buildChangeApiTokenExpiryAudit = ([params], result, error) =>
  buildAudit(params, result, error);

const changeWithAudit = withAudit(changeExpiry, buildChangeApiTokenExpiryAudit);

export const changeApiTokenExpiryUseCase = answeringTokens((params) =>
  params.service === GAS
    ? withTransaction((session) => changeWithAudit(params, session))
    : changeWithAudit(params),
);
