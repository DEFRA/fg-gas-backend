import Joi from "joi";
import { env } from "node:process";

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
  GRANT_APPLICATION_APPROVED_TOPIC_ARN: Joi.string().optional(),
  AWS_REGION: Joi.string(),
  AWS_ENDPOINT_URL: Joi.string().uri().optional(),
  CASE_STAGE_UPDATES_QUEUE_URL: Joi.string().uri(),
  ENVIRONMENT: Joi.string(),
  GAS__SNS__GRANT_APPLICATION_CREATED_TOPIC_ARN: Joi.string().optional(),
  GAS__SNS__GRANT_APPLICATION_STATUS_UPDATED_TOPIC_ARN: Joi.string().optional(),
  GAS__SNS__CREATE_NEW_CASE_TOPIC_ARN: Joi.string().optional(),
  GAS__SNS__UPDATE_CASE_STATUS_TOPIC_ARN: Joi.string().optional(),
  GAS__SQS__UPDATE_STATUS_QUEUE_URL: Joi.string().uri().optional(),
  GAS__SQS__UPDATE_AGREEMENT_STATUS_QUEUE_URL: Joi.string().uri().optional(),
}).options({
  stripUnknown: true,
  allowUnknown: true,
  presence: "required",
});

const { error, value: vars } = schema.validate(env, {
  abortEarly: false,
});

if (error) {
  const errors = error.details.map((e) => e.message).join(", ");
  // eslint-disable-next-line no-console
  console.error(`Error in env config: ${errors}`);
  process.exit(1);
}

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
  applicationCreatedTopic: vars.GRANT_APPLICATION_CREATED_TOPIC_ARN,
  applicationApprovedTopic: vars.GRANT_APPLICATION_APPROVED_TOPIC_ARN,
  region: vars.AWS_REGION,
  awsEndpointUrl: vars.AWS_ENDPOINT_URL,
  caseStageUpdatesQueueUrl: vars.CASE_STAGE_UPDATES_QUEUE_URL,
  cdpEnvironment: vars.ENVIRONMENT,
  sns: {
    grantApplicationCreatedTopicArn:
      vars.GAS__SNS__GRANT_APPLICATION_CREATED_TOPIC_ARN,
    grantApplicationStatusUpdatedTopicArn:
      vars.GAS__SNS__GRANT_APPLICATION_STATUS_UPDATED_TOPIC_ARN,
    createNewCaseTopicArn: vars.GAS__SNS__CREATE_NEW_CASE_TOPIC_ARN,
    updateCaseStatusTopicArn: vars.GAS__SNS__UPDATE_CASE_STATUS_TOPIC_ARN,
  },
  sqs: {
    updateStatusQueueUrl: vars.GAS__SQS__UPDATE_STATUS_QUEUE_URL,
    updateAgreementStatusQueueUrl:
      vars.GAS__SQS__UPDATE_AGREEMENT_STATUS_QUEUE_URL,
  },
};
