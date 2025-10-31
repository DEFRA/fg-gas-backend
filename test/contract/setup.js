import { mkdir } from "node:fs/promises";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

// Ensure pacts directory exists
const pactsDir = resolve(__dirname, "../pacts");
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
