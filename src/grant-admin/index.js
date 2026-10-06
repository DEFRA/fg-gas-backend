import { requireAdminClient } from "./admin-client.js";
import { createEntitlementRoute } from "./routes/create-entitlement.route.js";
import { editPayloadRoute } from "./routes/edit-payload.route.js";
import { eventsPageRoute } from "./routes/events-page.route.js";
import { getClaimRoute } from "./routes/get-claim.route.js";
import { getClaimsRoute } from "./routes/get-claims.route.js";
import { getEventRoute } from "./routes/get-event.route.js";
import { purgeEventRoute } from "./routes/purge-event.route.js";
import { viewApplicationEventsRoute } from "./routes/view-application-events.route.js";
import { viewApplicationOverviewRoute } from "./routes/view-application-overview.route.js";
import { viewApplicationRawRoute } from "./routes/view-application-raw.route.js";
import { redriveEventRoute } from "./routes/redrive-event.route.js";
import { searchApplicationsRoute } from "./routes/search-applications.route.js";
import { searchCasesRoute } from "./routes/search-cases.route.js";
import { viewCaseEventsRoute } from "./routes/view-case-events.route.js";
import { viewCaseOverviewRoute } from "./routes/view-case-overview.route.js";
import { viewCaseRawRoute } from "./routes/view-case-raw.route.js";
import { setAuditActor } from "./set-audit-actor.js";

export const grantAdmin = {
  name: "grant-admin",
  register(server) {
    // Every route here answers the admin frontend alone; sandboxed to this plugin.
    server.ext("onPostAuth", requireAdminClient, { sandbox: "plugin" });
    server.ext("onPostAuth", setAuditActor, { sandbox: "plugin" });

    server.route([
      getClaimsRoute,
      getClaimRoute,
      createEntitlementRoute,
      eventsPageRoute,
      getEventRoute,
      redriveEventRoute,
      purgeEventRoute,
      editPayloadRoute,
      searchApplicationsRoute,
      viewApplicationOverviewRoute,
      viewApplicationEventsRoute,
      viewApplicationRawRoute,
      searchCasesRoute,
      viewCaseOverviewRoute,
      viewCaseEventsRoute,
      viewCaseRawRoute,
    ]);
  },
};
