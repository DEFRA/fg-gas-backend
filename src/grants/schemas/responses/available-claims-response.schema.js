import Joi from "joi";

const availableClaimDataField = Joi.object({
  value: Joi.alternatives()
    .try(Joi.number(), Joi.string(), Joi.boolean())
    .allow(null)
    .required(),
  decimalPlaces: Joi.number().integer().optional(),
  minValue: Joi.number().allow(null).optional(),
  maxValue: Joi.number().allow(null).optional(),
}).label("AvailableClaimDataField");

const availableClaim = Joi.object({
  code: Joi.string().required(),
  // Null for a materialised claimable, which cannot yet be claimed against.
  entitlementId: Joi.string().allow(null).required(),
  name: Joi.string().required(),
  description: Joi.string().allow(null).optional(),
  data: Joi.object().pattern(Joi.string(), availableClaimDataField).required(),
}).label("AvailableClaim");

export const availableClaimsResponseSchema = Joi.object({
  availableClaims: Joi.array().items(availableClaim).required(),
}).label("AvailableClaimsResponse");
