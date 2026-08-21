import Boom from "@hapi/boom";
import Joi from "joi";
import {
  resolveProcessMapping,
  validateProcessMapping,
} from "../../common/resolve-process-mapping.js";
import { paymentBusinessFieldsSchema } from "./payment.js";

const mappedString = Joi.string().required();
const mappedInteger = Joi.alternatives()
  .try(Joi.number().integer().strict(), Joi.string())
  .required();

const mappedCollection = (itemSchema) =>
  Joi.alternatives()
    .try(
      Joi.string(),
      Joi.array().items(itemSchema).min(1),
      Joi.object({
        itemsRef: Joi.string().required(),
        items: itemSchema.required(),
      }),
    )
    .required();

const invoiceLineMappingSchema = Joi.object({
  schemeCode: mappedString,
  description: mappedString,
  amountPence: mappedInteger,
  accountCode: mappedString,
  fundCode: mappedString,
  deliveryBody: mappedString,
  marketingYear: mappedString,
});

const duePaymentMappingSchema = Joi.object({
  dueDate: mappedString,
  totalAmountPence: mappedInteger,
  invoiceLines: mappedCollection(invoiceLineMappingSchema),
});

const configurationMappingSchema = Joi.object({
  sbi: mappedString,
  frn: mappedString,
  scheme: mappedString,
  sourceSystem: mappedString,
  deliveryBody: mappedString,
  fesCode: mappedString,
  originalInvoiceNumber: Joi.string().allow("").required(),
  ledger: mappedString,
  totalAmountPence: mappedInteger,
  currency: mappedString,
  marketingYear: mappedString,
  payments: mappedCollection(duePaymentMappingSchema),
}).required();

const definitionSchema = configurationMappingSchema.keys({
  code: Joi.string().required(),
  configVersion: Joi.forbidden(),
});

const invalid = (code, message) =>
  Boom.badImplementation(`Invalid Payment definition "${code}": ${message}`);

export class PaymentDefinition {
  constructor(rawDefinition, { code, configVersion }) {
    const { error, value } = definitionSchema.validate(rawDefinition, {
      abortEarly: false,
      allowUnknown: false,
      convert: false,
    });

    if (error) {
      throw invalid(code, error.message);
    }
    if (value.code !== code) {
      throw invalid(code, `code "${value.code}" does not match "${code}"`);
    }

    const { code: _code, ...configuration } = value;
    try {
      validateProcessMapping(configuration);
    } catch (mappingError) {
      throw invalid(code, mappingError.message);
    }

    this.code = code;
    this.configVersion = configVersion;
    this.configuration = Object.freeze(configuration);
  }

  async resolve(context) {
    const resolved = await resolveProcessMapping(this.configuration, context);
    const { error, value } = paymentBusinessFieldsSchema.validate(resolved, {
      abortEarly: false,
      allowUnknown: false,
      convert: false,
    });

    if (error) {
      throw invalid(this.code, error.message);
    }

    return value;
  }
}
