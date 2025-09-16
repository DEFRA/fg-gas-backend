import { logger } from "./common/logger.js";
import { grants } from "./grants/index.js";
import { health } from "./health/index.js";
import { createServer } from "./server.js";

process.on("unhandledRejection", (error) => {
  logger.error(error, "Unhandled rejection");
  process.exitCode = 1;
});

const server = await createServer();
await server.register([health, grants]);
await server.start();
