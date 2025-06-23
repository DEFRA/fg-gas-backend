import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60000,
    environment: "node",
    globals: true,
    setupFiles: ["./test/contracts/setup.js"],
  },
});
