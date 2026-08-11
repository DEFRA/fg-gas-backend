import Boom from "@hapi/boom";
import { agreementValueSchema } from "../../schemas/agreement-value.schema.js";
import { Agreement } from "../agreement.js";
import { compileApplicationMapping } from "./compile-application-mapping.js";
import { compileCreationValueMapping } from "./compile-creation-value-mapping.js";

const collectProcessOutputs = (outputs) =>
  Object.values(outputs).reduce(
    (agreementValues, output) => ({ ...agreementValues, ...output }),
    {},
  );

const mergeCreationValues = (mappedValues, outputs) => {
  const processValues = collectProcessOutputs(outputs);
  const competingFields = Object.keys(mappedValues).filter((field) =>
    Object.hasOwn(processValues, field),
  );

  if (competingFields.length > 0) {
    throw Boom.badImplementation(
      `Agreement creation has competing value producers for: ${competingFields.join(", ")}`,
    );
  }

  return { ...mappedValues, ...processValues };
};

const invalidCandidateReferences = () =>
  Boom.badImplementation(
    "Agreement creation produced invalid candidate references",
  );

const candidateReferences = (entries) =>
  entries.flatMap(({ ref }) => (ref === undefined ? [] : [ref]));

const hasUniqueReferences = (entries) => {
  if (!Array.isArray(entries)) {
    return false;
  }

  const references = candidateReferences(entries);

  return (
    references.every(
      (reference) => typeof reference === "string" && reference.length > 0,
    ) && new Set(references).size === references.length
  );
};

const allocateEntries = (entries, namespace) => {
  if (!hasUniqueReferences(entries)) {
    throw invalidCandidateReferences();
  }

  const references = new Map();
  const values = entries.map((candidate, index) => {
    const id = `${namespace}:${index + 1}`;
    const entry = structuredClone(candidate);
    if (candidate.ref !== undefined) {
      references.set(candidate.ref, id);
    }
    delete entry.ref;

    return { ...entry, id };
  });

  return { references, values };
};

const findLineItemReference = (lineItem, allocated) =>
  [
    {
      candidateField: "actionRef",
      persistedField: "actionId",
      references: allocated.actions.references,
    },
    {
      candidateField: "itemRef",
      persistedField: "itemId",
      references: allocated.items.references,
    },
  ].find(({ candidateField }) => Object.hasOwn(lineItem, candidateField));

const resolveLineItem = (lineItem, allocated) => {
  const reference = findLineItemReference(lineItem, allocated);

  if (!reference) {
    throw invalidCandidateReferences();
  }

  const id = reference.references.get(lineItem[reference.candidateField]);

  if (!id) {
    throw invalidCandidateReferences();
  }

  return {
    [reference.persistedField]: id,
    amountPence: lineItem.amountPence,
  };
};

const resolvePaymentSchedule = (paymentSchedule, allocated) => {
  if (!paymentSchedule) {
    return undefined;
  }

  return {
    ...paymentSchedule,
    instalments: paymentSchedule.instalments.map((instalment, index) => ({
      ...instalment,
      id: `instalment:${index + 1}`,
      lineItems: instalment.lineItems.map((lineItem) =>
        resolveLineItem(lineItem, allocated),
      ),
    })),
  };
};

const allocatePersistentIdentity = (candidates) => {
  const allocated = {
    actions: allocateEntries(candidates.actions, "action"),
    items: allocateEntries(candidates.items, "item"),
  };

  return {
    ...candidates,
    actions: allocated.actions.values,
    items: allocated.items.values,
    paymentSchedule: resolvePaymentSchedule(
      candidates.paymentSchedule,
      allocated,
    ),
  };
};

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
    allocatePersistentIdentity({
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

const assertNoCreationIntents = (intents = []) => {
  if (intents.length > 0) {
    throw Boom.badImplementation(
      "Agreement creation Processes produced unsupported intents",
    );
  }
};

export const compileAgreementCreation = (
  definition,
  { generateAgreementNumber, runProcesses },
) => {
  const resolveApplication = compileApplicationMapping(definition);
  const resolveCreationValues = compileCreationValueMapping(definition);

  return async ({ input, execution }) => {
    assertDefinitionMatchesInput(definition, input);
    assertCorrelationId(execution);

    const application = await resolveApplication(input);
    const mappedValues = await resolveCreationValues({ application, input });
    const { outputs, intents } = await runProcesses({
      location: { type: "create" },
      context: { application, execution },
    });
    assertNoCreationIntents(intents);

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
