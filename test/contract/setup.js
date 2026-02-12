import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "path";
import { fileURLToPath } from "url";

// Load .env.test if NOT running in local mode
if (process.env.PACT_USE_LOCAL !== "true" && existsSync(".env.test")) {
  process.loadEnvFile(".env.test");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

// Ensure pacts directory exists (tmp/pacts matches consumer test configuration)
const pactsDir = resolve(process.cwd(), "tmp/pacts");
const logsDir = resolve(__dirname, "../logs");

try {
  await mkdir(pactsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
} catch (error) {
  // Directories may already exist
}

// Setup global test utilities
global.testConfig = {
  pactsDir,
  logsDir,
};
