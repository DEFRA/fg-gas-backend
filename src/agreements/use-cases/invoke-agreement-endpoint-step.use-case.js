import Boom from "@hapi/boom";
import { resolveJSONPath } from "../../common/resolve-json.js";
import {
  resolveActionPath,
  setActionOutput,
} from "./agreement-action-paths.js";

const defaultCallEndpoint = () => {
  throw Boom.badRequest("Agreement endpoint caller is not configured");
};

const getEndpoint = (effect) => effect.params?.endpoint;

const resolveEndpointParams = ({ endpointParams = {}, root }) =>
  resolveJSONPath({ root, path: endpointParams });

const selectEndpointOutput = ({ response, root, effect }) =>
  resolveActionPath(
    {
      ...root,
      response,
    },
    effect.params?.output?.select ?? "$.response",
  );

const hasOutputMutation = (outputConfig) =>
  Boolean(outputConfig?.path || outputConfig?.target);

const applyEndpointOutput = ({ context, outputConfig, value }) => {
  if (!hasOutputMutation(outputConfig)) {
    return {};
  }

  const outputs = structuredClone(context.outputs);
  setActionOutput({
    object: outputs,
    output: outputConfig,
    value,
  });

  return { outputs };
};

const callConfiguredEndpoint = async ({ callEndpoint, endpoint, root }) => {
  const callEndpointHandler = callEndpoint ?? defaultCallEndpoint;

  return callEndpointHandler({
    context: root,
    endpoint,
    params: await resolveEndpointParams({
      endpointParams: endpoint?.endpointParams,
      root,
    }),
  });
};

export const invokeAgreementEndpointStep = async ({
  callEndpoint,
  context,
  effect,
}) => {
  const endpoint = getEndpoint(effect);
  const response = await callConfiguredEndpoint({
    callEndpoint,
    endpoint,
    root: context,
  });
  const output = selectEndpointOutput({
    response,
    root: context,
    effect,
  });
  const contextPatch = applyEndpointOutput({
    context,
    outputConfig: effect.params?.output,
    value: output,
  });

  return {
    output,
    ...contextPatch,
  };
};
