import Boom from "@hapi/boom";
import Joi from "joi";

const definitionSchema = Joi.object({
  code: Joi.string().required(),
  configVersion: Joi.forbidden(),
  scheme: Joi.string().required(),
  sourceSystem: Joi.string().required(),
  deliveryBody: Joi.string().required(),
  fesCode: Joi.string().required(),
  ledger: Joi.string().required(),
  currency: Joi.string().required(),
  invoiceLine: Joi.object({
    schemeCode: Joi.string().optional(),
    description: Joi.string().optional(),
    accountCode: Joi.string().required(),
    fundCode: Joi.string().required(),
  }).required(),
}).required();

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

    this.code = code;
    this.configVersion = configVersion;
    this.configuration = Object.freeze({
      scheme: value.scheme,
      sourceSystem: value.sourceSystem,
      deliveryBody: value.deliveryBody,
      fesCode: value.fesCode,
      ledger: value.ledger,
      currency: value.currency,
      invoiceLine: Object.freeze({ ...value.invoiceLine }),
    });
  }

  resolve({ executedAt }) {
    const date = new Date(executedAt);
    if (Number.isNaN(date.getTime())) {
      throw invalid(this.code, '"executedAt" must be an ISO date');
    }

    return structuredClone({
      ...this.configuration,
      marketingYear: String(date.getUTCFullYear()),
    });
  }
}
