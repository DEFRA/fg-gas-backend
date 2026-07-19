import { callAgreementEndpoint } from "../call-agreement-endpoint.js";
import { resolveEffectParams } from "../resolve-effect-params.js";

export const callEndpointEffect = async (context, { params = {} }) => {
  const endpointConfig = findEndpointConfig(context, params.endpoint?.code);
  const resolvedParams = await resolveEffectParams(
    params.endpoint.endpointParams ?? {},
    context,
  );
  const output = await callAgreementEndpoint(endpointConfig, resolvedParams);

  return { output };
};

const findEndpointConfig = (context, endpointCode) => {
  const endpointConfig = context.endpoints?.find(
    (candidate) => candidate.code === endpointCode,
  );

  if (!endpointConfig) {
    throw new Error(`No endpoint configured for code "${endpointCode}"`);
  }

  return endpointConfig;
};
