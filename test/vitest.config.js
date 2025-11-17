/// <reference types="vitest/config" />
import { defineConfig } from "vite";

const GAS_PORT = 3001;
const MONGO_PORT = 27018;
const LOCALSTACK_PORT = 4567;

const SQS_URL = `http://sqs.eu-west-2.127.0.0.1:${LOCALSTACK_PORT}/000000000000`;

export default defineConfig({
  test: {
    globalSetup: "./test/setup.js",
    setupFiles: [
      "./test/matchers.js",
      "./test/cleanup.js",
      ".test/auth-setup.js",
    ],
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
    exclude: ["**/contract/**"],
    env: {
      GAS_PORT,
      MONGO_PORT,
      LOCALSTACK_PORT,
      API_URL: `http://localhost:${GAS_PORT}`,
      MONGO_URI: `mongodb://localhost:${MONGO_PORT}/fg-gas-backend?directConnection=true`,
      AWS_REGION: "eu-west-2",
      AWS_ENDPOINT_URL: `http://localhost:${LOCALSTACK_PORT}`,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      GAS__SNS__GRANT_APPLICATION_CREATED_TOPIC_ARN:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__grant_application_created",
      GAS__SQS__GRANT_APPLICATION_CREATED_QUEUE_URL: `${SQS_URL}/gas__sqs__grant_application_created`,
      GAS__SQS__GRANT_APPLICATION_STATUS_UPDATED_QUEUE_URL: `${SQS_URL}/gas__sqs__grant_application_status_updated`,
      CW__SQS__CREATE_NEW_CASE_QUEUE_URL: `${SQS_URL}/cw__sqs__create_new_case`,
      GAS__SQS__UPDATE_STATUS_QUEUE_URL: `${SQS_URL}/gas__sqs__update_status`,
      GAS__SNS__CREATE_AGREEMENT_TOPIC_ARN:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement",
      GAS__SNS__GRANT_APPLICATION_STATUS_UPDATED_TOPIC_ARN:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__grant_application_status_updated",
      CREATE_AGREEMENT_QUEUE_URL: `${SQS_URL}/create_agreement`,
      GAS__SNS__CREATE_NEW_CASE_TOPIC_ARN:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case",
      OUTBOX_MAX_RETRIES: 2,
      OUTBOX_CLAIM_MAX_RECORDS: 2,
      OUTBOX_EXPIRES_MS: 5000,
      OUTBOX_POLL_MS: 250,
      INBOX_MAX_RETRIES: 2,
      INBOX_CLAIM_MAX_RECORDS: 2,
      INBOX_EXPIRES_MS: 5000,
      INBOX_POLL_MS: 250,
    },
    hookTimeout: 30000,
    testTimeout: 10000,
  },
});
