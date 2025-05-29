import { db } from "../common/mongo-client.js";
import { caseStageUpdatedSubscriber } from "./subscribers/case-stage-updated.subscriber.js";

import { createGrantRoute } from "./routes/create-grant.route.js";
import { findGrantByCodeRoute } from "./routes/find-grant-by-code.route.js";
import { findGrantsRoute } from "./routes/find-grants.route.js";
import { invokeGetActionRoute } from "./routes/invoke-get-action.route.js";
import { invokePostActionRoute } from "./routes/invoke-post-action.route.js";
import { replaceGrantRoute } from "./routes/replace-grant.route.js";
import { submitApplicationRoute } from "./routes/submit-application.route.js";

export const grants = {
  name: "grants",
  async register(server) {
    await Promise.all([
      db.createIndex("grants", { code: 1 }, { unique: true }),
      db.createIndex("applications", { clientRef: 1 }, { unique: true }),
    ]);

    server.events.on("start", async () => {
      await caseStageUpdatedSubscriber.start();
    });

    server.events.on("stop", async () => {
      await caseStageUpdatedSubscriber.stop();
    });

    server.route([
      createGrantRoute,
      replaceGrantRoute,
      findGrantsRoute,
      findGrantByCodeRoute,
      invokeGetActionRoute,
      invokePostActionRoute,
      submitApplicationRoute,
    ]);
  },
};
