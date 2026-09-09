import Boom from "@hapi/boom";
import Joi from "joi";
import { catchUpWoodlandMigration } from "./catch-up-woodland-migration.js";

const operatorService = "woodland-migration-operator";
const checksumSchema = Joi.string()
  .pattern(/^sha256:[0-9a-f]{64}$/)
  .required();

const requestHasBody = (request) =>
  Number(request.headers["content-length"]) > 0 ||
  request.headers["transfer-encoding"] !== undefined;

export const catchUpWoodlandMigrationRoute = {
  method: "POST",
  path: "/admin/migrations/woodland/catch-up",
  options: {
    description:
      "Catch up the legacy Woodland agreement migration after cutover",
    tags: ["api"],
    validate: {
      payload: Joi.any().empty(null).forbidden(),
    },
    response: {
      schema: Joi.object({
        valid: Joi.boolean().valid(true).required(),
        agreements: Joi.number().integer().min(0).required(),
        offeredAgreements: Joi.number().integer().min(0).required(),
        acceptedAgreements: Joi.number().integer().min(0).required(),
        versions: Joi.number().integer().min(0).required(),
        inserted: Joi.number().integer().min(0).required(),
        updated: Joi.number().integer().min(0).required(),
        preserved: Joi.number().integer().min(0).required(),
        failed: Joi.number().integer().min(0).required(),
        failures: Joi.array()
          .items(
            Joi.object({
              agreementNumber: Joi.string().required(),
              reason: Joi.string().required(),
            }),
          )
          .required(),
        sourceChecksum: checksumSchema,
      }),
    },
  },
  handler(request) {
    if (request.auth.credentials.service !== operatorService) {
      throw Boom.forbidden("Woodland migration catch-up is restricted");
    }
    if (requestHasBody(request)) {
      throw Boom.badRequest("Woodland migration catch-up requires no body");
    }
    return catchUpWoodlandMigration();
  },
};
