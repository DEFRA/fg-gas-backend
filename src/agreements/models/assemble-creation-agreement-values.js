import Boom from "@hapi/boom";
import { agreementValueSchema } from "../schemas/agreement-value.schema.js";

const collectProcessOutputs = (outputs) =>
  Object.values(outputs).reduce(
    (agreementValues, output) => ({ ...agreementValues, ...output }),
    {},
  );

const allocateIds = (entries, namespace) =>
  Array.isArray(entries)
    ? entries.map((entry, index) => ({
        ...entry,
        id: `${namespace}:${index + 1}`,
      }))
    : entries;

const allocateEntryIds = (values) => ({
  ...values,
  actions: allocateIds(values.actions, "action"),
  items: allocateIds(values.items, "item"),
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

export const assembleCreationAgreementValues = ({ application, outputs }) =>
  validateAgreementValues(
    allocateEntryIds({
      application: structuredClone(application),
      ...collectProcessOutputs(outputs),
    }),
  );
