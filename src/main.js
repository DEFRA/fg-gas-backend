import { agreements } from "./agreements/index.js";
import { seedAccessToken } from "./auth/seed-access-token.js";
import { assertDefinitionCheckRegistered } from "./common/config-broker/definition-checks.js";
import { logger } from "./common/logger.js";
import { grantAdmin } from "./grant-admin/index.js";
import { events } from "./events/index.js";
import { grants } from "./grants/index.js";
import { health } from "./health/index.js";
import { payments } from "./payments/index.js";
import { createServer } from "./server.js";
import { testEndpoints } from "./test-endpoints/index.js";

process.on("unhandledRejection", (error) => {
  logger.error(error, "Unhandled rejection");
  process.exitCode = 1;
});

const server = await createServer();
await server.register([
  health,
  grants,
  agreements,
  grantAdmin,
  testEndpoints,
  events,
  payments,
]);
// Configuration messages are processed only after startup, but fail startup
// explicitly if the Payments plugin stops providing its definition check.
assertDefinitionCheckRegistered("payment");
// After register, which runs the migrations, and before any request is served.
await seedAccessToken();
await server.start();
