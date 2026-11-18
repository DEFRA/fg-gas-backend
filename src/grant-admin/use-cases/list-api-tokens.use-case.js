import { listApiTokens } from "../../auth/services/api-client.service.js";
import {
  PMC_0706_SECURITY,
  auditActions,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { findCwApiTokens } from "../repositories/cw-clients.repository.js";
import { GAS } from "../services/event-sources.js";
import { isExpiringSoon } from "../services/token-expiry.js";
import { buildApiClientAudit } from "./api-client-audit.js";

const readTokens = ({ service, callerHash, encodedActor }) =>
  service === GAS
    ? listApiTokens({ callerHash })
    : findCwApiTokens({ actor: encodedActor });

// Each token says whether it is expiring soon by the Overview's rule.
const listTokens = async (args) => {
  const { tokens } = await readTokens(args);
  const now = new Date();

  return {
    service: args.service,
    tokens: tokens.map((token) => ({
      ...token,
      expiringSoon: isExpiringSoon(token, now),
    })),
  };
};

export const listApiTokensUseCase = auditedRead(
  listTokens,
  buildApiClientAudit(auditActions.VIEW_API_CLIENT, PMC_0706_SECURITY),
);
