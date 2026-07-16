import Boom from "@hapi/boom";
import { findAgreementDefinition } from "./agreement-definition-registry.js";
import { AgreementDefinition } from "./agreement-definition.js";

export const loadAgreementDefinition = async ({ code, configVersion }) => {
  const definition = findAgreementDefinition({ code, configVersion });

  if (!definition) {
    throw Boom.badImplementation(
      `Agreement definition "${code}" version "${configVersion}" is unavailable`,
    );
  }

  return new AgreementDefinition(definition);
};
