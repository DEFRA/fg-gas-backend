/// <reference types="vitest/config" />
import { defineConfig } from "vite";

const GAS_PORT = 3001;
const MONGO_PORT = 27018;
const LOCALSTACK_PORT = 4566;

export default defineConfig({
  test: {
    globalSetup: "./test/setup.js",
    env: {
      GAS_PORT,
      MONGO_PORT,
      LOCALSTACK_PORT,
      API_URL: `http://localhost:${GAS_PORT}`,
      MONGO_URI: `mongodb://localhost:${MONGO_PORT}/fg-gas-backend`,
      AWS_REGION: "eu-west-2",
      AWS_ENDPOINT: `http://localhost:${LOCALSTACK_PORT}`,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
    },
    hookTimeout: 30000,
  },
});
