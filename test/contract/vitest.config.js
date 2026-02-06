import { defineConfig } from "vitest/config";

const GAS_PORT = 3001;
const MONGO_PORT = 27018;
const LOCALSTACK_PORT = 4567;

export default defineConfig({
  test: {
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    testTimeout: 60000,
    environment: "node",
    globals: true,
    setupFiles: ["./test/contract/setup.js"],
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
    env: {
      GAS_PORT,
      MONGO_PORT,
      LOCALSTACK_PORT,
      API_URL: `http://localhost:${GAS_PORT}`,
      MONGO_URI: `mongodb://localhost:${MONGO_PORT}/fg-gas-backend`,
      AWS_REGION: "eu-west-2",
      AWS_ENDPOINT_URL: `http://localhost:${LOCALSTACK_PORT}`,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      FIFO_LOCK_TTL_MS: 5000,
      GAS__SNS__GRANT_APPLICATION_CREATED_TOPIC_ARN:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__grant_application_created_fifo.fifo",
      GRANT_APPLICATION_CREATED_QUEUE_URL: `http://sqs.eu-west-2.127.0.0.1:${LOCALSTACK_PORT}/000000000000/gas__sqs__handle_grant_application_created_fifo.fifo`,
      CASE_STAGE_UPDATES_QUEUE_URL: `http://sqs.eu-west-2.127.0.0.1:${LOCALSTACK_PORT}/000000000000/case_stage_updated_fifo.fifo`,
      CREATE_NEW_CASE_QUEUE_URL: `http://sqs.eu-west-2.127.0.0.1:${LOCALSTACK_PORT}/000000000000/cw__sqs__create_new_case_fifo.fifo`,
    },
  },
});
