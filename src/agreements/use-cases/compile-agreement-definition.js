import Boom from "@hapi/boom";
import {
  EndpointServiceUrlError,
  validateEndpointServiceUrls,
} from "../services/integrations/resolve-endpoint-service-url.js";
import { logger } from "../../common/logger.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import { callAgreementEndpoint } from "../services/integrations/call-agreement-endpoint.js";
import { validateAgreementDefinition } from "../models/agreement-definitions/validate.js";

const toVersionedDefinition = (rawDefinition, code, version) => {
  if (rawDefinition.code !== code) {
    throw Boom.badImplementation(
      `Agreement definition code "${rawDefinition.code}" does not match "${code}"`,
    );
  }

  // Producers cannot set the platform-owned configVersion.
  if (rawDefinition.configVersion !== undefined) {
    throw Boom.badImplementation(
      `Agreement definition "${code}" must not declare configVersion; it is applied from the config catalog`,
    );
  }

  return { ...rawDefinition, configVersion: version };
};

export const compileAgreementDefinition = (rawDefinition, code, version) => {
  const definition = toVersionedDefinition(rawDefinition, code, version);
  // Built first so every structural check runs even when a service URL is missing.
  const compiled = new AgreementDefinition(definition, {
    callEndpoint: callAgreementEndpoint,
  });
  validateEndpointServiceUrls([validateAgreementDefinition(definition)]);
  return compiled;
};

// Every rule the runtime runs on load except the service URLs, which judge
// this deployment rather than the stored definition. The model it answers has
// no endpoint caller, so it never calls a service.
export const checkStoredAgreementDefinition = (rawDefinition, code, version) =>
  new AgreementDefinition(toVersionedDefinition(rawDefinition, code, version));

// The seam for checking a published definition before it is recorded. A missing service
// URL is this deployment's problem, not the config's, so it is swallowed here: only
// Agreements knows that difference, and the caller must not record a good version as
// broken because of our own settings.
export const checkAgreementDefinition = (rawDefinition, code, version) => {
  try {
    compileAgreementDefinition(rawDefinition, code, version);
  } catch (error) {
    if (error instanceof EndpointServiceUrlError) {
      logger.warn(
        `Skipped the endpoint service URL check for Agreement definition ${code}@${version}: ${error.message}`,
      );
      return;
    }

    throw error;
  }
};
