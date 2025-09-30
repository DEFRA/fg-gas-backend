import { up } from "migrate-mongo";
import { logger } from "../common/logger.js";
import { db, mongoClient } from "../common/mongo-client.js";
import { addOutboxRoute } from "./routes/add-outbox.js";
import { applicationStatusRoute } from "./routes/application-status.route.js";
import { createGrantRoute } from "./routes/create-grant.route.js";
import { findGrantByCodeRoute } from "./routes/find-grant-by-code.route.js";
import { findGrantsRoute } from "./routes/find-grants.route.js";
import {
  invokeGetActionRoute,
  invokePostActionRoute,
} from "./routes/invoke-action.route.js";
import { replaceGrantRoute } from "./routes/replace-grant.route.js";
import { submitApplicationRoute } from "./routes/submit-application.route.js";
import { agreementStatusUpdatedSubscriber } from "./subscribers/agreement-status-updated.subscriber.js";
import { caseStatusUpdatedSubscriber } from "./subscribers/case-status-updated.subscriber.js";

import { OutboxSubscriber } from "../common/outbox-poll.js";

const outboxSub = new OutboxSubscriber(30000);

export const grants = {
  name: "grants",
  async register(server) {
    logger.info("Running migrations");
    const migrated = await up(db, mongoClient);
    migrated.forEach((fileName) => logger.info(`Migrated: ${fileName}`));
    logger.info("Finished running migrations");

    server.events.on("start", async () => {
      agreementStatusUpdatedSubscriber.start();
      caseStatusUpdatedSubscriber.start();
      outboxSub.start();
    });

    server.events.on("stop", async () => {
      agreementStatusUpdatedSubscriber.stop();
      caseStatusUpdatedSubscriber.stop();
      outboxSub.stop();
    });

    server.route([
      addOutboxRoute,
      createGrantRoute,
      replaceGrantRoute,
      findGrantsRoute,
      findGrantByCodeRoute,
      invokeGetActionRoute,
      invokePostActionRoute,
      submitApplicationRoute,
      applicationStatusRoute,
    ]);
  },
};
