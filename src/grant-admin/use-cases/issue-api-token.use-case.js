import { issueApiToken } from "../../auth/services/api-client.service.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  PMC_0705_SECURITY,
  auditActions,
} from "../../events/audit-constants.js";
import { withAudit } from "../../events/with-audit.js";
import { issueCwApiToken } from "../repositories/cw-clients.repository.js";
import { GAS } from "../services/event-sources.js";
import { buildApiClientAudit } from "./api-client-audit.js";

const issueOnGas = (params, session) =>
  issueApiToken(
    {
      clientId: params.clientId,
      tokenHash: params.tokenHash,
      tokenHint: params.tokenHint,
      expiresAt: params.expiresAt,
      newClient: params.newClient,
      by: params.actor,
    },
    session,
  );

const issueOnCw = (params) =>
  issueCwApiToken(
    params.clientId,
    {
      tokenHash: params.tokenHash,
      tokenHint: params.tokenHint,
      expiresAt: params.expiresAt,
      newClient: params.newClient,
    },
    { actor: params.encodedActor },
  );

const issue = async (params, session) => {
  logger.info(`Issue API token ${params.service}/${params.clientId}`);

  const { token } =
    params.service === GAS
      ? await issueOnGas(params, session)
      : await issueOnCw(params);

  logger.info(
    `Finished: Issue API token ${params.service}/${params.clientId}/${token.tokenId}`,
  );

  return { service: params.service, token };
};

const buildAudit = buildApiClientAudit(
  auditActions.ISSUE_API_TOKEN,
  PMC_0705_SECURITY,
);

export const buildIssueApiTokenAudit = ([params], result, error) =>
  buildAudit(params, result, error);

const issueWithAudit = withAudit(issue, buildIssueApiTokenAudit);

// GAS: the row and its audit event commit together. Caseworking cannot join
// the transaction; it audits the change itself.
export const issueApiTokenUseCase = (params) =>
  params.service === GAS
    ? withTransaction((session) => issueWithAudit(params, session))
    : issueWithAudit(params);
