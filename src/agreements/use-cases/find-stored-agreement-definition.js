import { logger } from "../../common/logger.js";
import { findStoredAgreementDefinitionDocument } from "../repositories/agreement-definition.repository.js";
import {
  missingEndpointServiceUrls,
  toServiceAddress,
} from "../services/integrations/resolve-endpoint-service-url.js";
import { checkStoredAgreementDefinition } from "./compile-agreement-definition.js";

const MAX_PROBLEM_LENGTH = 500;

const problemWith = (definition, grantCode, version) => {
  try {
    checkStoredAgreementDefinition(definition, grantCode, version);
    return null;
  } catch (error) {
    logger.warn(
      `Stored Agreement definition ${grantCode}@${version} cannot be loaded: ${error.message}`,
    );
    return error.message.slice(0, MAX_PROBLEM_LENGTH);
  }
};

const serviceAddressesOf = (definition) =>
  Object.entries(definition.processDefinitions ?? {})
    .filter(([, process]) => process.type === "endpoint")
    .map(([process, { endpoint }]) => ({
      process,
      service: endpoint.service,
      url: toServiceAddress(endpoint),
    }));

const endpointAddressesOf = (definition) =>
  (definition.endpoints ?? []).map((endpoint) => ({
    code: endpoint.code,
    service: endpoint.service,
    url: toServiceAddress(endpoint),
  }));

const endpointFactsOf = (definition) => ({
  addresses: serviceAddressesOf(definition),
  endpointAddresses: endpointAddressesOf(definition),
  missingServiceUrls: missingEndpointServiceUrls([definition]),
});

const NO_ENDPOINT_FACTS = {
  addresses: [],
  endpointAddresses: [],
  missingServiceUrls: [],
};

// A stored definition the runtime would refuse is answered as stored, beside
// the rule it breaks.
export const findStoredAgreementDefinition = async (
  { grantCode, version },
  { maxBytes },
) => {
  const stored = await findStoredAgreementDefinitionDocument(
    grantCode,
    version,
    { maxBytes },
  );

  if (!stored) {
    return null;
  }

  const { definition } = stored;

  if (definition === null) {
    return { definition: null, ...NO_ENDPOINT_FACTS, problem: null };
  }

  const problem = problemWith(definition, grantCode, version);

  return {
    definition,
    ...(problem ? NO_ENDPOINT_FACTS : endpointFactsOf(definition)),
    problem,
  };
};
