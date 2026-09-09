import Joi from "joi";
import { applyWoodlandMigration } from "./apply-woodland-migration.js";

const checksumSchema = Joi.string()
  .pattern(/^sha256:[0-9a-f]{64}$/)
  .required();

export const applyWoodlandMigrationRoute = {
  method: "POST",
  path: "/admin/migrations/woodland/apply",
  options: {
    description: "Apply the legacy Woodland agreement migration",
    tags: ["api"],
    validate: {
      payload: Joi.object({
        confirmation: Joi.string().valid("APPLY_WOODLAND_MIGRATION").required(),
        expectedAgreements: Joi.number().integer().min(1).required(),
        expectedVersions: Joi.number().integer().min(1).required(),
        sourceChecksum: checksumSchema,
      }).required(),
    },
    response: {
      schema: Joi.object({
        valid: Joi.boolean().valid(true).required(),
        agreements: Joi.number().integer().min(1).required(),
        offeredAgreements: Joi.number().integer().min(0).required(),
        acceptedAgreements: Joi.number().integer().min(0).required(),
        versions: Joi.number().integer().min(1).required(),
        inserted: Joi.number().integer().min(0).required(),
        replaced: Joi.number().integer().min(0).required(),
        skipped: Joi.number().integer().min(0).required(),
        sourceChecksum: checksumSchema,
      }),
    },
  },
  handler: (request) => applyWoodlandMigration(request.payload),
};
