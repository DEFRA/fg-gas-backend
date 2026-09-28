import { requireAdminClient } from "./admin-client.js";
import { createEntitlementRoute } from "./routes/create-entitlement.route.js";
import { eventsPageRoute } from "./routes/events-page.route.js";
import { getClaimRoute } from "./routes/get-claim.route.js";
import { getClaimsRoute } from "./routes/get-claims.route.js";
import { getEventRoute } from "./routes/get-event.route.js";
import { purgeEventRoute } from "./routes/purge-event.route.js";
import { redriveEventRoute } from "./routes/redrive-event.route.js";

export const grantAdmin = {
  name: "grant-admin",
  register(server) {
    // Every route here answers the admin frontend alone; sandboxed to this plugin.
    server.ext("onPostAuth", requireAdminClient, { sandbox: "plugin" });

    server.route([
      getClaimsRoute,
      getClaimRoute,
      createEntitlementRoute,
      eventsPageRoute,
      getEventRoute,
      redriveEventRoute,
      purgeEventRoute,
    ]);
  },
};
