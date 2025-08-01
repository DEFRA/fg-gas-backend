/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    restoreMocks: true,
    coverage: {
      reporter: ["text", "lcov", "html"],
    },
    env: {
      NODE_ENV: "test",
      SERVICE_NAME: "fg-gas-backend",
      SERVICE_VERSION: "0.0.0",
      PORT: "3000",
      LOG_ENABLED: "true",
      LOG_LEVEL: "info",
      LOG_FORMAT: "pino-pretty",
      TRACING_HEADER: "x-cdp-request-id",
      MONGO_URI: "mongodb://127.0.0.1:27017/",
      MONGO_DATABASE: "fg-gas-backend",
      GRANT_APPLICATION_CREATED_TOPIC_ARN:
        "arn:aws:sns:eu-west-2:000000000000:grant_application_created",
      GRANT_APPLICATION_APPROVED_TOPIC_ARN:
        "arn:aws:sns:eu-west-2:000000000000:grant_application_approved",
      AWS_REGION: "eu-west-2",
      AWS_ENDPOINT_URL: "http://localhost:4566",
      CASE_STAGE_UPDATES_QUEUE_URL:
        "http://sqs.eu-west-2.127.0.0.1:4567/000000000000/case_stage_updated",
      ENVIRONMENT: "local",
    },
  },
});
