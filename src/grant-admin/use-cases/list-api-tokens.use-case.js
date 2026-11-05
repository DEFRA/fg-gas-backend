import { listApiTokens } from "../../auth/services/api-client.service.js";
import {
  PMC_0706_SECURITY,
  auditActions,
} from "../../events/audit-constants.js";
import { auditedRead } from "../../events/audited-read.js";
import { findCwApiTokens } from "../repositories/cw-clients.repository.js";
import { GAS } from "../services/event-sources.js";
import { buildApiClientAudit } from "./api-client-audit.js";

const listTokens = async ({ service, callerHash, encodedActor }) => ({
  service,
  ...(service === GAS
    ? await listApiTokens({ callerHash })
    : await findCwApiTokens({ actor: encodedActor })),
});

export const listApiTokensUseCase = auditedRead(
  listTokens,
  buildApiClientAudit(auditActions.VIEW_API_CLIENT, PMC_0706_SECURITY),
);
