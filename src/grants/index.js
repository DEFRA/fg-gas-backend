import { up } from "migrate-mongo";
import { registerBucket } from "../common/buckets/registry.js";
import { registerDefinitionStore } from "../common/config-broker/definition-stores.js";
import { AGREEMENT_STATUS_UPDATED_EVENT_TYPE } from "../agreements/events/agreement-status-updated.event.js";
import { config } from "../common/config.js";
import { logger } from "../common/logger.js";
import { db, mongoClient } from "../common/mongo-client.js";
import { SearchReindexer } from "../common/search/reindexer.js";
import { SearchSweeper } from "../common/search/sweeper.js";
import { registerSearchSource } from "../common/search/source.js";
import { registerEventHandler } from "../events/index.js";
import { messageSource } from "../events/services/message-source.js";
import { applicationsBucket } from "./buckets/applications.bucket.js";
import { grantsBucket } from "./buckets/grants.bucket.js";
import { handleConfigVersionMessage } from "./handlers/handle-config-version-message.js";
import { handleGrantStatusMessage } from "./handlers/handle-grant-status-message.js";
import {
  CASE_STATUS_UPDATED_EVENT_TYPE,
  CONFIG_VERSION_UPDATED_EVENT_TYPE,
} from "./events/inbound-event-types.js";
import { applicationStatusRoute } from "./routes/application-status.route.js";
import {
  checkAllowListRoute,
  missingAllowListIdentifiersRoute,
} from "./routes/check-allow-list.route.js";
import { getAvailableClaimsRoute } from "./routes/get-available-claims.route.js";
import {
  getAvailableGrantsRoute,
  missingAvailableGrantsIdentifiersRoute,
} from "./routes/get-available-grants.route.js";
import {
  invokeGetActionRoute,
  invokePostActionRoute,
} from "./routes/invoke-action.route.js";
import { submitApplicationRoute } from "./routes/submit-application.route.js";
import { submitClaimRoute } from "./routes/submit-claim.route.js";
import { findStoredVersions } from "./repositories/grant.repository.js";
import { applicationSearch } from "./search/application-search.js";
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
    registerDefinitionStore("grant", { storedVersions: findStoredVersions });

    logger.info("Running migrations");
    const migrated = await up(db, mongoClient);
    migrated.forEach((fileName) => logger.info(`Migrated: ${fileName}`));
    logger.info("Finished running migrations");

    registerSearchSource(applicationSearch);
    registerBucket(applicationsBucket());
    registerBucket(grantsBucket());

    const searchReindexer = new SearchReindexer({
      source: applicationSearch,
      intervalMs: config.search.reindexIntervalMs,
    });
    const searchSweeper = new SearchSweeper({
      source: applicationSearch,
      batchSize: config.search.sweepBatch,
      intervalMs: config.search.sweepIntervalMs,
    });

    server.events.on("start", async () => {
      configVersionUpdatedSubscriber.start();
      searchReindexer.start();
      searchSweeper.start();
    });

    server.events.on("stop", async () => {
      configVersionUpdatedSubscriber.stop();
      searchReindexer.stop();
      searchSweeper.stop();
    });

    server.route([
      getAvailableGrantsRoute,
      missingAvailableGrantsIdentifiersRoute,
      checkAllowListRoute,
      missingAllowListIdentifiersRoute,
      invokeGetActionRoute,
      invokePostActionRoute,
      submitApplicationRoute,
      applicationStatusRoute,
      getAvailableClaimsRoute,
      submitClaimRoute,
    ]);
  },
};
