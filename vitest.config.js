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
      AWS_REGION: "eu-west-2",
      AWS_ENDPOINT_URL: "http://localhost:4566",
      ENVIRONMENT: "local",
      OUTBOX_MAX_RETRIES: 5,
      OUTBOX_CLAIM_MAX_RECORDS: 2,
      OUTBOX_EXPIRES_MS: 5000,
      OUTBOX_POLL_MS: 250,
    },
  },
});
