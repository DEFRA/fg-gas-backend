/// <reference types="vitest/config" />
import { defineConfig } from "vite";

const GAS_PORT = 3001;
const MONGO_PORT = 27018;

export default defineConfig({
  test: {
    globalSetup: "./test/setup.js",
    env: {
      GAS_PORT,
      MONGO_PORT,
      API_URL: `http://localhost:${GAS_PORT}`,
      MONGO_URI: `mongodb://localhost:${MONGO_PORT}/fg-gas-backend`,
    },
    hookTimeout: 30000,
  },
});
