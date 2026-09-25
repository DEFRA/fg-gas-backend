import Boom from "@hapi/boom";
import {
  EndpointServiceUrlError,
  validateEndpointServiceUrls,
} from "../services/integrations/resolve-endpoint-service-url.js";
import { logger } from "../../common/logger.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import { callAgreementEndpoint } from "../services/integrations/call-agreement-endpoint.js";
import { validateAgreementDefinition } from "../models/agreement-definitions/validate.js";

export const compileAgreementDefinition = (rawDefinition, code, version) => {
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

  const definition = { ...rawDefinition, configVersion: version };
  validateEndpointServiceUrls([validateAgreementDefinition(definition)]);
  return new AgreementDefinition(definition, {
    callEndpoint: callAgreementEndpoint,
  });
};

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
        `Skipped Agreement definition checks for ${code}@${version}: ${error.message}`,
      );
      return;
    }

    throw error;
  }
};
