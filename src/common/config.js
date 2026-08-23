import Joi from "joi";
import { env } from "node:process";

// FGP-1307: the producer services permitted to mint caller tokens
// (applicant/grants-ui, caseworker/fg-cw-frontend, PDF/agreements-pdf). This is
// the same in every environment, so it is a code constant rather than
// configuration — it cannot be misconfigured to an empty list and needs no
// cdp-app-config entry.
const CALLER_TOKEN_ALLOWED_ISSUERS = Object.freeze([
  "grants-ui",
  "fg-cw-frontend",
  "agreements-pdf",
]);

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
  AWS_REGION: Joi.string(),
  AWS_ENDPOINT_URL: Joi.string().uri().optional(),
  ENVIRONMENT: Joi.string(),
  OUTBOX_MAX_RETRIES: Joi.number(),
  OUTBOX_EXPIRES_MS: Joi.number(),
  OUTBOX_CLAIM_MAX_RECORDS: Joi.number(),
  OUTBOX_POLL_MS: Joi.number(),
  INBOX_MAX_RETRIES: Joi.number(),
  INBOX_EXPIRES_MS: Joi.number(),
  INBOX_CLAIM_MAX_RECORDS: Joi.number(),
  INBOX_POLL_MS: Joi.number(),
  FIFO_LOCK_TTL_MS: Joi.number(),
  GAS__SNS__AUDIT_TOPIC_ARN: Joi.string().optional(),
  GAS__SNS__CREATE_AGREEMENT_TOPIC_ARN: Joi.string().optional(),
  GAS_MANAGED_AGREEMENT_GRANT_CODES: Joi.string()
    .allow("")
    .optional()
    .default(""),
  GAS__SNS__GRANT_APPLICATION_CREATED_TOPIC_ARN: Joi.string().optional(),
  GAS__SNS__GRANT_APPLICATION_STATUS_UPDATED_TOPIC_ARN: Joi.string().optional(),
  GAS__SNS__CREATE_NEW_CASE_TOPIC_ARN: Joi.string().optional(),
  GAS__SNS__UPDATE_CASE_STATUS_TOPIC_ARN: Joi.string().optional(),
  GAS__SQS__UPDATE_STATUS_QUEUE_URL: Joi.string().uri().optional(),
  GAS__SQS__UPDATE_AGREEMENT_STATUS_QUEUE_URL: Joi.string().uri().optional(),
  GAS__SQS__CONFIG_VERSION_QUEUE_URL: Joi.string().uri().optional(),
  GAS__SNS__UPDATE_AGREEMENT_STATUS_TOPIC_ARN: Joi.string().optional(),
  GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN: Joi.string(),
  GAS__SNS__CREATE_PAYMENT_TOPIC_ARN: Joi.string().optional(),
  VIEW_AGREEMENT_URI: Joi.string().uri().required(),
  CONFIG_BROKER_S3_BUCKET: Joi.string().optional(),
  AGREEMENTS_JWT_SECRET: Joi.string().optional(),
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
  viewAgreementUri: vars.VIEW_AGREEMENT_URI,
  managedAgreementGrantCodes: vars.GAS_MANAGED_AGREEMENT_GRANT_CODES.split(",")
    .map((code) => code.trim())
    .filter(Boolean),
  region: vars.AWS_REGION,
  awsEndpointUrl: vars.AWS_ENDPOINT_URL,
  cdpEnvironment: vars.ENVIRONMENT,
  outbox: {
    outboxMaxRetries: vars.OUTBOX_MAX_RETRIES,
    outboxExpiresMs: vars.OUTBOX_EXPIRES_MS,
    outboxClaimMaxRecords: vars.OUTBOX_CLAIM_MAX_RECORDS,
    outboxPollMs: vars.OUTBOX_POLL_MS,
  },
  inbox: {
    inboxMaxRetries: vars.INBOX_MAX_RETRIES,
    inboxExpiresMs: vars.INBOX_EXPIRES_MS,
    inboxClaimMaxRecords: vars.INBOX_CLAIM_MAX_RECORDS,
    inboxPollMs: vars.INBOX_POLL_MS,
  },
  fifoLock: {
    ttlMs: vars.FIFO_LOCK_TTL_MS,
  },
  sns: {
    updateAgreementStatusTopicArn:
      vars.GAS__SNS__UPDATE_AGREEMENT_STATUS_TOPIC_ARN,
    agreementStatusUpdatedTopicArn:
      vars.GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN,
    createAgreementTopicArn: vars.GAS__SNS__CREATE_AGREEMENT_TOPIC_ARN,
    grantApplicationCreatedTopicArn:
      vars.GAS__SNS__GRANT_APPLICATION_CREATED_TOPIC_ARN,
    grantApplicationStatusUpdatedTopicArn:
      vars.GAS__SNS__GRANT_APPLICATION_STATUS_UPDATED_TOPIC_ARN,
    createNewCaseTopicArn: vars.GAS__SNS__CREATE_NEW_CASE_TOPIC_ARN,
    updateCaseStatusTopicArn: vars.GAS__SNS__UPDATE_CASE_STATUS_TOPIC_ARN,
    auditTopicArn: vars.GAS__SNS__AUDIT_TOPIC_ARN,
    createPaymentTopicArn: vars.GAS__SNS__CREATE_PAYMENT_TOPIC_ARN,
  },
  sqs: {
    updateStatusQueueUrl: vars.GAS__SQS__UPDATE_STATUS_QUEUE_URL,
    updateAgreementStatusQueueUrl:
      vars.GAS__SQS__UPDATE_AGREEMENT_STATUS_QUEUE_URL,
    configVersionQueueUrl: vars.GAS__SQS__CONFIG_VERSION_QUEUE_URL,
  },
  configBroker: {
    s3Bucket: vars.CONFIG_BROKER_S3_BUCKET,
  },
  // FGP-1307: shared secret used to verify the caller token forwarded by
  // Agreements UI. Audience is "gas" for now (the interim token also carries
  // "agreements-ui"); this moves to token exchange / per-issuer keys later.
  // allowedIssuers is the fixed list of producer services permitted to mint
  // caller tokens; an unrecognised issuer is reported as a warning during the
  // warn-only rollout.
  callerToken: {
    secret: vars.AGREEMENTS_JWT_SECRET,
    audience: "gas",
    allowedIssuers: CALLER_TOKEN_ALLOWED_ISSUERS,
  },
};
