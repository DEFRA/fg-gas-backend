import { up } from "migrate-mongo";
import { AGREEMENT_STATUS_UPDATED_EVENT_TYPE } from "../agreements/events/agreement-status-updated.event.js";
import { logger } from "../common/logger.js";
import { db, mongoClient } from "../common/mongo-client.js";
import { registerEventHandler } from "../events/index.js";
import { messageSource } from "../events/services/message-source.js";
import { handleConfigVersionMessage } from "./handlers/handle-config-version-message.js";
import { handleGrantStatusMessage } from "./handlers/handle-grant-status-message.js";
import {
  CASE_STATUS_UPDATED_EVENT_TYPE,
  CONFIG_VERSION_UPDATED_EVENT_TYPE,
} from "./events/inbound-event-types.js";
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

const grantStatusHandler = (source) => (message) =>
  handleGrantStatusMessage({ ...message, source });

const handleAgreementStatus = grantStatusHandler(
  messageSource.AgreementService,
);
const handleCaseStatus = grantStatusHandler(messageSource.CaseWorking);

export const grants = {
  name: "grants",
  async register(server) {
    registerEventHandler(
      AGREEMENT_STATUS_UPDATED_EVENT_TYPE,
      handleAgreementStatus,
    );
    registerEventHandler(CASE_STATUS_UPDATED_EVENT_TYPE, handleCaseStatus);
    registerEventHandler(
      CONFIG_VERSION_UPDATED_EVENT_TYPE,
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
