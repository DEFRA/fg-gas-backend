import Boom from "@hapi/boom";
import { agreementValueSchema } from "../../schemas/agreement-value.schema.js";
import { Agreement } from "../agreement.js";
import { materialiseCreationIdentities } from "../materialise-agreement-identities.js";
import { compileCreationMappings } from "./compile-creation-mappings.js";

const collectProcessOutputs = (outputs) =>
  Object.values(outputs).reduce(
    (agreementValues, output) => ({ ...agreementValues, ...output }),
    {},
  );

const mergeCreationValues = (mappedValues, outputs) => ({
  ...mappedValues,
  ...collectProcessOutputs(outputs),
});

const validateAgreementValues = (values) => {
  const result = agreementValueSchema.validate(values, {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  });

  if (result.error) {
    throw Boom.badImplementation(
      "Agreement creation produced invalid Agreement values",
    );
  }

  return structuredClone(result.value);
};

const assembleAgreementValues = ({ application, mappedValues, outputs }) =>
  validateAgreementValues(
    materialiseCreationIdentities({
      application: structuredClone(application),
      ...mergeCreationValues(mappedValues, outputs),
    }),
  );

const assertDefinitionMatchesInput = (definition, input) => {
  if (input?.code !== definition.code) {
    throw Boom.badImplementation(
      `Agreement Creation Input code "${input?.code}" does not match Agreement Definition "${definition.code}"`,
    );
  }
};

const assertCorrelationId = (execution) => {
  if (!execution?.correlationId) {
    throw Boom.badImplementation(
      "Agreement creation requires an Agreement Correlation ID",
    );
  }
};

const assertNoCreationCommitOperations = (commitOperations) => {
  if (commitOperations.length > 0) {
    throw Boom.badImplementation(
      "Agreement creation Processes produced unsupported commit operations",
    );
  }
};

export const compileAgreementCreation = (
  definition,
  { generateAgreementNumber, runProcesses },
) => {
  const resolveCreationMappings = compileCreationMappings(definition);

  return async ({ input, execution }) => {
    assertDefinitionMatchesInput(definition, input);
    assertCorrelationId(execution);

    const { application, mappedValues } = await resolveCreationMappings(input);
    const { outputs, commitOperations } = await runProcesses({
      location: { type: "create" },
      context: { application, execution },
    });
    assertNoCreationCommitOperations(commitOperations);

    const values = assembleAgreementValues({
      application,
      mappedValues,
      outputs,
    });

    return Agreement.create({
      agreementNumber: generateAgreementNumber({
        prefix: definition.agreementNumberPrefix,
      }),
      code: definition.code,
      clientRef: input.clientRef,
      configVersion: definition.configVersion,
      correlationId: execution.correlationId,
      createdAt: execution.executedAt,
      identifiers: input.identifiers,
      values,
      state: definition.create.target,
    });
  };
};
