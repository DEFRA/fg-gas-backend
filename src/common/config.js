import { env } from "node:process";
import Joi from "joi";

export const config = {
  env: env.NODE_ENV,
  serviceName: env.SERVICE_NAME,
  serviceVersion: env.SERVICE_VERSION,
  port: env.PORT,
  logEnabled: env.LOG_ENABLED,
  logLevel: env.LOG_LEVEL,
  logFormat: env.LOG_FORMAT,
  mongoUri: env.MONGO_URI,
  mongoDatabase: env.MONGO_DATABASE,
  tracingHeader: "x-cdp-request-id",
};

const schema = Joi.object({
  env: Joi.string().allow("development", "production", "test"),
  serviceName: Joi.string(),
  serviceVersion: Joi.string(),
  port: Joi.number(),
  logEnabled: Joi.boolean(),
  logLevel: Joi.string().allow(
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
    "silent",
  ),
  logFormat: Joi.string().allow("ecs", "pino-pretty"),
  mongoUri: Joi.string().uri(),
  mongoDatabase: Joi.string(),
}).options({
  allowUnknown: true,
  presence: "required",
});

Joi.assert(config, schema);
