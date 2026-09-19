import { up } from "migrate-mongo";
import { registerInternalCommandHandler } from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { logger } from "../common/logger.js";
import { db, mongoClient } from "../common/mongo-client.js";
import { registerInboxMessageHandler } from "../events/services/inbox-message-handlers.js";
import {
  messageSource,
  saveInboxMessageUseCase,
} from "../events/use-cases/save-inbox-message.js";
import { handleConfigVersionMessage } from "./events/handle-config-version-message.js";
import { handleGrantStatusMessage } from "./events/handle-grant-status-message.js";
import { applicationStatusRoute } from "./routes/application-status.route.js";
import { createGrantRoute } from "./routes/create-grant.route.js";
import { findGrantByCodeRoute } from "./routes/find-grant-by-code.route.js";
import { findGrantsRoute } from "./routes/find-grants.route.js";
import { getAvailableClaimsRoute } from "./routes/get-available-claims.route.js";
import {
  invokeGetActionRoute,
  invokePostActionRoute,
} from "./routes/invoke-action.route.js";
import { replaceGrantRoute } from "./routes/replace-grant.route.js";
import { submitApplicationRoute } from "./routes/submit-application.route.js";
import { submitClaimRoute } from "./routes/submit-claim.route.js";
import { configVersionUpdatedSubscriber } from "./subscribers/config-version-updated.subscriber.js";

export const grants = {
  name: "grants",
  async register(server) {
    registerInternalCommandHandler(
      internalCommandTypes.AGREEMENT_STATUS_UPDATED,
      (event) => saveInboxMessageUseCase(event, messageSource.AgreementService),
    );
    registerInboxMessageHandler(
      messageSource.AgreementService,
      handleGrantStatusMessage,
    );
    registerInboxMessageHandler(
      messageSource.CaseWorking,
      handleGrantStatusMessage,
    );
    registerInboxMessageHandler(
      messageSource.ConfigBroker,
      handleConfigVersionMessage,
    );

    logger.info("Running migrations");
    const migrated = await up(db, mongoClient);
    migrated.forEach((fileName) => logger.info(`Migrated: ${fileName}`));
    logger.info("Finished running migrations");

    server.events.on("start", async () => {
      configVersionUpdatedSubscriber.start();
    });

    server.events.on("stop", async () => {
      configVersionUpdatedSubscriber.stop();
    });

    server.route([
      createGrantRoute,
      replaceGrantRoute,
      findGrantsRoute,
      findGrantByCodeRoute,
      invokeGetActionRoute,
      invokePostActionRoute,
      submitApplicationRoute,
      applicationStatusRoute,
      getAvailableClaimsRoute,
      submitClaimRoute,
    ]);
  },
};
