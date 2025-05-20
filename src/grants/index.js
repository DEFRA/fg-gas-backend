import { db } from "../common/db.js";
import { config } from "../common/config.js";
import { SqsConsumer } from "../common/sqs-consumer.js";

import { createGrantRoute } from "./routes/create-grant-route.js";
import { findAllGrantsRoute } from "./routes/find-all-grants-route.js";
import { findGrantByCodeRoute } from "./routes/find-grant-by-code-route.js";
import { invokeGrantGetActionRoute } from "./routes/invoke-grant-get-action-route.js";
import { invokePostActionRoute } from "./routes/invoke-post-action-route.js";
import { onCaseStageUpdated } from "./subscriptions/on-case-stage-updated.js";

/**
 * @type {import('@hapi/hapi').Plugin<any>}
 */
export const grantsPlugin = {
  name: "grants",
  async register(server) {
    await Promise.all([
      db.createIndex("grants", { code: 1 }, { unique: true }),
      db.createIndex("applications", { clientRef: 1 }, { unique: true }),
    ]);

    const caseStageChangedConsumer = new SqsConsumer(server, {
      queueUrl: config.caseStageUpdatesQueueUrl,
      handleMessage: onCaseStageUpdated,
    });

    server.events.on("start", async () => {
      await caseStageChangedConsumer.start();
    });

    server.events.on("stop", async () => {
      await caseStageChangedConsumer.stop();
    });

    server.route([
      createGrantRoute,
      findAllGrantsRoute,
      findGrantByCodeRoute,
      invokeGrantGetActionRoute,
      invokePostActionRoute,
    ]);
  },
};
