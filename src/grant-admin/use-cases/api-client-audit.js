import { auditEntities } from "../../events/audit-constants.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { GATEWAY_TIMEOUT, statusOf } from "../repositories/cw-http.js";

// Unanswered is not refused: Caseworking may still have made the change.
const unexplained = (error) =>
  statusOf(error) === GATEWAY_TIMEOUT ? "TIMED_OUT" : "UNEXPECTED_FAILURE";

// Only the refusal's code is recorded. A message can quote what it refused.
export const errorCodeOf = (error) =>
  error.output?.payload?.errorCode ?? unexplained(error);

const tokenIdOf = (tokenId, result) => tokenId ?? result?.token?.tokenId;

const noExtra = () => ({});

// The audit drops nulls, so a token that never expires is recorded as such.
// An expiry that was refused is recorded as it was sent.
export const expiryOf = (expiresAt) => {
  if (expiresAt === null) {
    return "never";
  }

  return expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt;
};

// Named fields only: the arguments carry the token hash and the caller's hash.
// `auditedRead` passes the arguments as they are; `withAudit` as a list. An
// action's own facts come from `extraOf`, from the same named fields.
export const buildApiClientAudit =
  (action, security, extraOf = noExtra) =>
  (params, result, error) => {
    const { service, clientId, tokenId, newClient, caller, actor } = params;

    return buildAuditEvent({
      entity: auditEntities.API_CLIENT,
      action,
      entityid: clientId ?? service,
      details: {
        service,
        tokenId: tokenIdOf(tokenId, result),
        newClient,
        caller,
        actor,
        ...extraOf(params, result),
        ...(error && { errorCode: errorCodeOf(error) }),
      },
      security,
      segregationRef: `api-client-${service}`,
    });
  };
