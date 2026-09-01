import Joi from "joi";
import { dryRunWoodlandMigration } from "./dry-run-woodland-migration.js";

export const dryRunWoodlandMigrationRoute = {
  method: "POST",
  path: "/admin/migrations/woodland/dry-run",
  options: {
    description: "Dry-run the legacy Woodland agreement migration",
    tags: ["api"],
    response: {
      schema: Joi.object({
        valid: Joi.boolean().required(),
        agreements: Joi.number().integer().min(0).required(),
        versions: Joi.number().integer().min(0).required(),
        failures: Joi.number().integer().min(0).required(),
      }),
    },
  },
  handler: dryRunWoodlandMigration,
};
