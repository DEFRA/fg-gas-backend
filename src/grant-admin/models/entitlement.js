import Boom from "@hapi/boom";
import Joi from "joi";
import { randomUUID } from "node:crypto";

const deepFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }

  return value;
};

export class Entitlement {
  static validationSchema = Joi.object({
    id: Joi.string().required(),
    clientRef: Joi.string().required(),
    code: Joi.string().required(),
    claimCode: Joi.string().required(),
    configVersion: Joi.string().required(),
    data: Joi.object()
      .pattern(
        Joi.string(),
        Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()),
      )
      .min(1)
      .required(),
    createdAt: Joi.string().required(),
  });

  constructor(props) {
    const { error, value } = Entitlement.validationSchema.validate(props, {
      stripUnknown: true,
      abortEarly: false,
    });

    if (error) {
      throw Boom.badRequest(
        `Invalid Entitlement: ${error.details.map((detail) => detail.message).join(", ")}`,
      );
    }

    Object.assign(this, structuredClone(value));
    deepFreeze(this);
  }

  static create({
    id = randomUUID(),
    createdAt = new Date().toISOString(),
    ...props
  }) {
    return new Entitlement({ ...props, id, createdAt });
  }
}
