import Boom from "@hapi/boom";
import {
  resolveProcessMapping,
  validateProcessMapping,
} from "../../common/agreements/resolve-process-mapping.js";
import {
  paymentDefinitionSchema,
  resolvedPaymentValueSchema,
} from "../schemas/payment-definition.schema.js";

const mappingFields = [
  "sbi",
  "frn",
  "scheme",
  "sourceSystem",
  "deliveryBody",
  "fesCode",
  "ledger",
  "totalAmountPence",
  "currency",
  "marketingYear",
  "duePayments",
];

const duePaymentFields = ["dueDate", "totalAmountPence", "invoiceLines"];
const invoiceLineFields = [
  "schemeCode",
  "description",
  "amountPence",
  "accountCode",
  "fundCode",
];

const isObject = (value) => value !== null && typeof value === "object";

const mappingItems = (mapping) => {
  if (Array.isArray(mapping)) {
    return mapping.flatMap(mappingItems);
  }

  if (isObject(mapping) && Object.hasOwn(mapping, "itemsRef")) {
    return mappingItems(mapping.items);
  }

  return [mapping];
};

const findUnknownField = (mapping, fields, findNestedField) =>
  mappingItems(mapping)
    .filter(isObject)
    .map((item) => {
      const unknown = Object.keys(item).find((key) => !fields.includes(key));
      return unknown || findNestedField(item);
    })
    .find(Boolean);

const findUnknownInvoiceLineField = (mapping) =>
  findUnknownField(mapping, invoiceLineFields, () => undefined);

const findUnknownDuePaymentField = (mapping) =>
  findUnknownField(mapping, duePaymentFields, (duePayment) => {
    const unknown = findUnknownInvoiceLineField(duePayment.invoiceLines);
    return unknown ? `invoiceLines.${unknown}` : undefined;
  });

const validationMessage = (error) =>
  error.details
    ? error.details.map((detail) => detail.message).join(", ")
    : error.message;

const invalidDefinition = (code, error) =>
  Boom.badImplementation(
    `Invalid Payment definition "${code}": ${validationMessage(error)}`,
  );

const selectMappings = (definition) =>
  Object.fromEntries(mappingFields.map((field) => [field, definition[field]]));

const requireDefinitionObject = (definition) => {
  if (!isObject(definition) || Array.isArray(definition)) {
    throw new TypeError("Payment definition must be an object");
  }
};

const validateDefinition = (definition) => {
  const { error, value } = paymentDefinitionSchema.validate(definition, {
    abortEarly: false,
    allowUnknown: false,
  });

  if (error) {
    throw error;
  }

  return value;
};

const validateNestedMappings = (mappings) => {
  const unknown = findUnknownDuePaymentField(mappings.duePayments);
  if (unknown) {
    throw new Error(`"duePayments.${unknown}" is not allowed`);
  }
};

export class PaymentDefinition {
  #mappings;

  constructor(definition) {
    let code;

    try {
      requireDefinitionObject(definition);
      code = definition.code;
      const value = validateDefinition(definition);
      const mappings = selectMappings(value);
      validateProcessMapping(mappings);
      validateNestedMappings(mappings);

      this.code = value.code;
      this.#mappings = structuredClone(mappings);
    } catch (error) {
      throw invalidDefinition(code, error);
    }
  }

  async resolve(context) {
    try {
      const resolved = await resolveProcessMapping(this.#mappings, context);
      const { error, value } = resolvedPaymentValueSchema.validate(resolved, {
        abortEarly: false,
        allowUnknown: false,
        convert: false,
      });

      if (error) {
        throw error;
      }

      return value;
    } catch (error) {
      if (Boom.isBoom(error)) {
        throw error;
      }

      throw invalidDefinition(this.code, error);
    }
  }
}
