import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import {
  WORKFLOW_VERSION_NOT_FOUND,
  fetchCwWorkflowDefinition,
} from "../repositories/cw-actuators.repository.js";
import { GATEWAY_TIMEOUT, statusOf } from "../repositories/cw-http.js";

const fetchWorkflowDefinition = ({ code, version, actor }) =>
  fetchCwWorkflowDefinition({ code, version }, { by: actor });

const toAuditFile = ({ file, outcome, reason }) => ({
  file,
  outcome,
  ...(reason && { reason }),
});

const reasonOf = (error) => error.output?.payload?.reason;

// Unanswered is not refused: Caseworking may still have stored the workflow.
const errorCodeOf = (error) => {
  if (reasonOf(error) === WORKFLOW_VERSION_NOT_FOUND) {
    return WORKFLOW_VERSION_NOT_FOUND;
  }

  return statusOf(error) === GATEWAY_TIMEOUT
    ? "TIMED_OUT"
    : "UNEXPECTED_FAILURE";
};

// Caseworking audits what it stored; this records that the operator asked.
export const buildFetchWorkflowDefinitionAudit = (
  [{ code, version, caller }],
  result,
  error,
) =>
  buildAuditEvent({
    entity: auditEntities.WORKFLOW,
    action: auditActions.FETCH_CONFIG_DEFINITION,
    entityid: code,
    details: {
      caller,
      version,
      files: error ? [] : result.files.map(toAuditFile),
      ...(error && { errorCode: errorCodeOf(error) }),
    },
    security: PMC_0706_SECURITY,
    segregationRef: `fetch-definition-${code}`,
  });

export const fetchWorkflowDefinitionUseCase = withAudit(
  fetchWorkflowDefinition,
  buildFetchWorkflowDefinitionAudit,
);
