import { env } from "node:process";
import Joi from "joi";

const schema = Joi.object({
  NODE_ENV: Joi.string().allow("development", "production", "test"),
  SERVICE_NAME: Joi.string(),
  SERVICE_VERSION: Joi.string(),
  PORT: Joi.number(),
  LOG_ENABLED: Joi.boolean(),
  LOG_LEVEL: Joi.string().allow(
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
    "silent",
  ),
  LOG_FORMAT: Joi.string().allow("ecs", "pino-pretty"),
  MONGO_URI: Joi.string(),
  MONGO_DATABASE: Joi.string(),
  TRACING_HEADER: Joi.string(),
  GRANT_APPLICATION_CREATED_TOPIC_ARN: Joi.string(),
  AWS_ENDPOINT_URL: Joi.string(),
}).options({
  stripUnknown: true,
  allowUnknown: true,
  presence: "required",
});

const vars = Joi.attempt(env, schema);

export const config = {
  env: vars.NODE_ENV,
  serviceName: vars.SERVICE_NAME,
  serviceVersion: vars.SERVICE_VERSION,
  port: vars.PORT,
  logEnabled: vars.LOG_ENABLED,
  logLevel: vars.LOG_LEVEL,
  logFormat: vars.LOG_FORMAT,
  mongoUri: vars.MONGO_URI,
  mongoDatabase: vars.MONGO_DATABASE,
  tracingHeader: vars.TRACING_HEADER,
  grantApplicationCreatedTopic: vars.GRANT_APPLICATION_CREATED_TOPIC_ARN,
  awsEndointUrl: vars.AWS_ENDPOINT_URL,
};
