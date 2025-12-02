import { spawn } from "node:child_process";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DevContainers } from "./dev-containers.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(dirname, "..");

const containers = new DevContainers();
let appProcess = null;
let isShuttingDown = false;

const main = async () => {
  try {
    // Start containers and get environment variables
    const containerEnv = await containers.start();

    // Merge container env with existing process.env
    // Container env vars override .env file values
    const appEnv = {
      ...process.env,
      ...containerEnv,
    };

    console.log("");

    // Spawn the application as child process with nodemon
    // Using nodemon directly for hot-reload support
    appProcess = spawn(
      "npx",
      ["nodemon", "--env-file", ".env", "src/main.js"],
      {
        cwd: rootDir,
        env: appEnv,
        stdio: "inherit",
      },
    );

    appProcess.on("exit", (code, signal) => {
      if (!isShuttingDown) {
        console.log(
          `\n📦 Application exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
        );
        process.exitCode = code ?? 0;
        cleanup();
      }
    });

    appProcess.on("error", (error) => {
      console.error("❌ Failed to start application:", error.message);
      process.exitCode = 1;
      cleanup();
    });
  } catch (error) {
    console.error("❌ Failed to start development environment:", error);
    process.exitCode = 1;
    cleanup();
  }
};

const cleanup = async () => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log("\n🛑 Shutting down...");

  // Kill app process if still running
  if (appProcess && !appProcess.killed) {
    appProcess.kill("SIGTERM");

    // Give it 5 seconds to shutdown gracefully, then force kill
    setTimeout(() => {
      if (appProcess && !appProcess.killed) {
        console.log("⚠️  Force killing application...");
        appProcess.kill("SIGKILL");
      }
    }, 5000);
  }

  // Show container reuse message
  await containers.stop();

  process.exit(process.exitCode ?? 0);
};

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n📥 Received SIGINT (Ctrl+C)");
  cleanup();
});

process.on("SIGTERM", () => {
  console.log("\n📥 Received SIGTERM");
  cleanup();
});

// Catch unhandled errors
process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled rejection in dev wrapper:", error);
  process.exitCode = 1;
  cleanup();
});

// Start the development environment
main();
