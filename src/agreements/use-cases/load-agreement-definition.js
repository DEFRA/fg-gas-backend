import Boom from "@hapi/boom";
import {
  EndpointServiceUrlError,
  validateEndpointServiceUrls,
} from "../../common/agreements/resolve-endpoint-service-url.js";
import {
  createDefinitionLoader,
  defaultClassifyFailure,
} from "../../common/config-broker/definition-loader.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";
import { prepareAgreementPayment } from "../../payments/use-cases/prepare-agreement-payment.use-case.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import { createAgreementProcessHandlers } from "../models/agreement-definitions/processes/agreement-process-registries.js";
import { validateAgreementDefinition } from "../models/agreement-definitions/validate.js";
import {
  findAgreementDefinition as findStoredDefinition,
  insertAgreementDefinition,
} from "../repositories/agreement-definition.repository.js";

const assertDefinitionIdentity = (rawDefinition, code) => {
  if (rawDefinition.code !== code) {
    throw Boom.badImplementation(
      `Agreement definition code "${rawDefinition.code}" does not match "${code}"`,
    );
  }
  if (rawDefinition.configVersion !== undefined) {
    throw Boom.badImplementation(
      `Agreement definition "${code}" must not declare configVersion; it is applied from the config catalog`,
    );
  }
};

const compileDefinition = (rawDefinition, { code, configVersion }) => {
  assertDefinitionIdentity(rawDefinition, code);
  const definition = { ...rawDefinition, configVersion };
  validateEndpointServiceUrls([validateAgreementDefinition(definition)]);
  return new AgreementDefinition(definition, {
    handlers: createAgreementProcessHandlers({
      prepareAgreementPayment: ({ agreement, execution }) =>
        prepareAgreementPayment({
          code,
          configVersion,
          agreement,
          execution,
        }),
    }),
  });
};

// Deployment faults are local, so do not record them against shared config.
const environmentFault = { status: FetchStatus.TransientError, record: false };

const classifyFailure = (error) =>
  error instanceof EndpointServiceUrlError
    ? environmentFault
    : defaultClassifyFailure(error);

const writeStored = async (target, rawDefinition) => {
  try {
    await insertAgreementDefinition({
      code: target.grantCode,
      version: target.version,
      definition: rawDefinition,
    });
  } catch (error) {
    if (!isMongoDuplicateKeyError(error)) {
      throw error;
    }
  }
};

const loader = createDefinitionLoader({
  definitionType: "agreement",
  label: "Agreement",
  compile: compileDefinition,
  classifyFailure,
  readStored: (target) =>
    findStoredDefinition(target.grantCode, target.version),
  writeStored,
});

export const loadAgreementDefinition = (options) => loader.load(options);

// Reset module caches between tests.
export const clearAgreementDefinitionCaches = loader.clearCaches;

// acceptedAt keeps the definition pinned after later state transitions.
export const loadDefinitionForAgreement = (agreement) =>
  loadAgreementDefinition({
    code: agreement.code,
    configVersion: agreement.configVersion,
    resolution: agreement.acceptedAt ? "exact" : "same-major",
  });
