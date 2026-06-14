import { randomUUID } from "node:crypto";
import { agreementActionCommandFromRequest } from "../models/agreement-action-command.js";
import { agreementActionResult } from "../models/agreement-action-result.js";
import { getAgreementAction } from "../models/agreement-definition-resolver.js";
import { callAgreementEndpoint } from "../services/agreement-endpoint-client.js";
import { generateClaimId as generateConfiguredClaimId } from "../services/claim-id-generator.js";
import { runAgreementProcessingSteps } from "./agreement-processing-step-runner.js";
import { findAgreementActionTarget } from "./find-agreement-action-target.use-case.js";
import { publishAgreementResult } from "./publish-agreement-result.use-case.js";

const defaultDependencies = {
  callEndpoint: callAgreementEndpoint,
  createCorrelationId: randomUUID,
  createId: randomUUID,
  generateClaimId: generateConfiguredClaimId,
  getAgreementAction,
  now: () => new Date().toISOString(),
};

const resolveDependencies = (dependencies) => ({
  ...defaultDependencies,
  ...dependencies,
});

const isAlreadyInTargetStatus = ({ action, itemState }) =>
  itemState?.status === action.toStatus;

export const executeAgreementAction = async (
  actionRequest,
  session,
  dependencies = {},
) => {
  const {
    callEndpoint,
    createCorrelationId,
    createId,
    generateClaimId,
    getAgreementAction,
    now,
  } = resolveDependencies(dependencies);
  const command = agreementActionCommandFromRequest(actionRequest);
  const executedAt = now();
  const { agreement, item, previousItemState, previousVersion } =
    await findAgreementActionTarget(command, session);
  const action = getAgreementAction({
    agreementCode: item.agreementCode,
    actionName: command.actionName,
  });

  if (isAlreadyInTargetStatus({ action, itemState: previousItemState })) {
    return agreementActionResult({
      agreement,
      item,
      publication: {},
      status: previousItemState.status,
      version: previousVersion,
    });
  }

  const result = await runAgreementProcessingSteps({
    action,
    callEndpoint,
    executedAt,
    agreement,
    command,
    createCorrelationId,
    createId,
    generateClaimId,
    item,
    previousItemState,
    previousVersion,
    session,
  });
  const actionResult = agreementActionResult({
    agreement,
    item,
    publication: result.publication,
    status: result.status,
    version: result.version,
  });

  await publishAgreementResult(actionResult, session);

  return actionResult;
};
