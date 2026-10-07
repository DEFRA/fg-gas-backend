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

export class InvalidEntitlementData extends Error {}

const toStoredValues = (submittedData) =>
  Object.fromEntries(
    Object.entries(submittedData).map(([name, field]) => [name, field.value]),
  );

export class Entitlement {
  static validationSchema = Joi.object({
    id: Joi.string().required(),
    clientRef: Joi.string().required(),
    code: Joi.string().required(),
    claimCode: Joi.string().required(),
    instanceNumber: Joi.number().integer().min(1).required(),
    configVersion: Joi.string().required(),
    data: Joi.object()
      .pattern(
        Joi.string(),
        Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()),
      )
      .min(1)
      .required(),
    createdAt: Joi.string().required(),
    updatedAt: Joi.string(),
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

  static fromDocument(document) {
    return new Entitlement(document);
  }

  // Only the fields a case officer supplies change; the fixed ones keep the
  // values they were resolved to on creation.
  withInputData(template, submittedData, updatedAt = new Date().toISOString()) {
    if (template.claimCode !== this.claimCode) {
      throw new Error(
        `Template '${template.claimCode}' is not the template of entitlement '${this.id}'`,
      );
    }

    if (!template.hasValidInputData(submittedData)) {
      throw new InvalidEntitlementData(
        `Entitlement '${this.id}' cannot take the data submitted`,
      );
    }

    return new Entitlement({
      ...this,
      data: { ...this.data, ...toStoredValues(submittedData) },
      updatedAt,
    });
  }

  static nextInstanceNumber(existing) {
    const used = new Set(
      existing
        .map((entitlement) => entitlement.instanceNumber)
        .filter(Number.isInteger),
    );

    let instanceNumber = 1;

    while (used.has(instanceNumber)) {
      instanceNumber += 1;
    }

    return instanceNumber;
  }
}
