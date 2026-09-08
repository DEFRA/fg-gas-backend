import { requireAdminClient } from "./admin-client.js";
import { createEntitlementRoute } from "./routes/create-entitlement.route.js";
import { eventsPageRoute } from "./routes/events-page.route.js";
import { findEventsRoute } from "./routes/find-events.route.js";
import { getClaimRoute } from "./routes/get-claim.route.js";
import { getClaimsRoute } from "./routes/get-claims.route.js";
import { getEventRoute } from "./routes/get-event.route.js";
import { redriveEventRoute } from "./routes/redrive-event.route.js";

export const grantAdmin = {
  name: "grant-admin",
  register(server) {
    // Every route below, and any added later, answers the admin frontend
    // alone. `sandbox: "plugin"` keeps the check on this plugin's own routes:
    // the rest of GAS's service API is open to the clients it was issued to.
    server.ext("onPostAuth", requireAdminClient, { sandbox: "plugin" });


    // `/page` cannot collide with the three-segment `/{service}/{box}/{id}`
    // routes - the segment counts differ.
    server.route([
      getClaimsRoute,
      getClaimRoute,
      createEntitlementRoute,
      findEventsRoute,
      eventsPageRoute,
      getEventRoute,
      redriveEventRoute,
    ]);
  },
};
