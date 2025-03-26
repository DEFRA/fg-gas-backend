import { env } from "node:process";
import Joi from "joi";

const schema = Joi.object({
  NODE_ENV: Joi.string()
    .allow("development", "production", "test")
    .default("development"),

  SERVICE_NAME: Joi.string().default("fg-gas-backend"),
  SERVICE_VERSION: Joi.string().default("0.0.0"),

  PORT: Joi.number().default(3000),

  LOG_ENABLED: Joi.boolean().default(true),
  LOG_LEVEL: Joi.string()
    .allow("fatal", "error", "warn", "info", "debug", "trace", "silent")
    .default("info"),
  LOG_FORMAT: Joi.string().allow("ecs", "pino-pretty").default("ecs"),

  MONGO_URI: Joi.string().uri().required(),
  MONGO_DATABASE: Joi.string().required(),

  TRACING_HEADER: Joi.string().default("x-cdp-request-id"),
}).options({
  stripUnknown: true,
});

export const config = Joi.attempt(env, schema);
