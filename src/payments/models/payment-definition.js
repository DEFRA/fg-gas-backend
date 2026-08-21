import Boom from "@hapi/boom";
import Joi from "joi";
import {
  resolveProcessMapping,
  validateProcessMapping,
} from "../../common/resolve-process-mapping.js";

const configurationSchema = Joi.object({
  scheme: Joi.string().required(),
  sourceSystem: Joi.string().required(),
  deliveryBody: Joi.string().required(),
  fesCode: Joi.string().required(),
  ledger: Joi.string().required(),
  currency: Joi.string().required(),
  marketingYear: Joi.string().required(),
  invoiceLine: Joi.object({
    schemeCode: Joi.string().optional(),
    description: Joi.string().optional(),
    accountCode: Joi.string().required(),
    fundCode: Joi.string().required(),
  }).required(),
}).required();

const definitionSchema = configurationSchema.keys({
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
    } catch (error) {
      throw invalid(code, error.message);
    }

    this.code = code;
    this.configVersion = configVersion;
    this.configuration = Object.freeze(configuration);
  }

  async resolve(context) {
    const resolved = await resolveProcessMapping(this.configuration, context);
    const { error, value } = configurationSchema.validate(resolved, {
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
