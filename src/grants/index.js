import { db } from "../common/db.js";
import { createGrantRoute } from "./routes/create-grant-route.js";
import { findAllGrantsRoute } from "./routes/find-all-grants-route.js";
import { findGrantByCodeRoute } from "./routes/find-grant-by-code-route.js";
import { invokeGrantGetActionRoute } from "./routes/invoke-grant-get-action-route.js";
import { invokePostActionRoute } from "./routes/invoke-post-action-route.js";

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

    server.route([
      createGrantRoute,
      findAllGrantsRoute,
      findGrantByCodeRoute,
      invokeGrantGetActionRoute,
      invokePostActionRoute,
    ]);
  },
};
