import Boom from "@hapi/boom";
import {
  resolveActionMap,
  resolveActionPath,
  setActionOutput,
} from "./agreement-action-paths.js";

const defaultCallEndpoint = () => {
  throw Boom.badRequest("Agreement endpoint caller is not configured");
};

const getResolutionRoot = ({ actionState, context }) => ({
  ...context,
  action: actionState,
});

const resolveEndpointParams = ({ endpointParams = {}, root }) =>
  Object.fromEntries(
    Object.entries(endpointParams).map(([paramType, paramMap]) => [
      paramType,
      resolveActionMap({ map: paramMap, root }),
    ]),
  );

const selectEndpointOutput = ({ response, root, step }) =>
  resolveActionPath(
    {
      ...root,
      response,
    },
    step.output?.select ?? "$.response",
  );

const applyEndpointOutput = ({ actionState, response, root, step }) => {
  if (!step.output) {
    return actionState;
  }

  const nextActionState = structuredClone(actionState);
  setActionOutput({
    object: nextActionState,
    output: step.output,
    value: selectEndpointOutput({ response, root, step }),
  });

  return nextActionState;
};

export const invokeAgreementEndpointStep = async ({
  actionState = {},
  callEndpoint,
  context,
  step,
}) => {
  const callConfiguredEndpoint = callEndpoint ?? defaultCallEndpoint;
  const root = getResolutionRoot({ actionState, context });
  const response = await callConfiguredEndpoint({
    context: root,
    endpoint: step.endpoint,
    params: resolveEndpointParams({
      endpointParams: step.endpoint?.endpointParams,
      root,
    }),
  });

  return applyEndpointOutput({
    actionState,
    response,
    root,
    step,
  });
};
