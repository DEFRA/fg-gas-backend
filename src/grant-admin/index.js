import { requireAdminClient } from "./admin-client.js";
import { createEntitlementRoute } from "./routes/create-entitlement.route.js";
import { editPayloadRoute } from "./routes/edit-payload.route.js";
import { getClaimRoute } from "./routes/get-claim.route.js";
import { getClaimsRoute } from "./routes/get-claims.route.js";
import { getEntitlementRoute } from "./routes/get-entitlement.route.js";
import { getEventRoute } from "./routes/get-event.route.js";
import { getAllowListRoute } from "./routes/get-allow-list.route.js";
import { fetchGrantDefinitionsRoute } from "./routes/fetch-grant-definitions.route.js";
import { fetchWorkflowDefinitionRoute } from "./routes/fetch-workflow-definition.route.js";
import { listGrantVersionsRoute } from "./routes/list-grant-versions.route.js";
import { listBucketsRoute } from "./routes/list-buckets.route.js";
import { purgeEventRoute } from "./routes/purge-event.route.js";
import { queryBucketRoute } from "./routes/query-bucket.route.js";
import { summariseBucketRoute } from "./routes/summarise-bucket.route.js";
import { viewApplicationEventsRoute } from "./routes/view-application-events.route.js";
import { viewApplicationOverviewRoute } from "./routes/view-application-overview.route.js";
import { viewApplicationRawRoute } from "./routes/view-application-raw.route.js";
import { redriveEventRoute } from "./routes/redrive-event.route.js";
import { replaceAllowListRoute } from "./routes/replace-allow-list.route.js";
import { viewCaseEventsRoute } from "./routes/view-case-events.route.js";
import { viewCaseOverviewRoute } from "./routes/view-case-overview.route.js";
import { viewCaseRawRoute } from "./routes/view-case-raw.route.js";
import { viewGrantVersionDefinitionRoute } from "./routes/view-grant-version-definition.route.js";
import { viewGrantVersionOverviewRoute } from "./routes/view-grant-version-overview.route.js";
import { viewGrantVersionPhasesRoute } from "./routes/view-grant-version-phases.route.js";
import { viewWorkflowVersionDefinitionRoute } from "./routes/view-workflow-version-definition.route.js";
import { viewWorkflowVersionOverviewRoute } from "./routes/view-workflow-version-overview.route.js";
import { viewWorkflowVersionRawRoute } from "./routes/view-workflow-version-raw.route.js";
import { viewWorkflowVersionsRoute } from "./routes/view-workflow-versions.route.js";
import { updateEntitlementRoute } from "./routes/update-entitlement.route.js";
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
      getEntitlementRoute,
      createEntitlementRoute,
      updateEntitlementRoute,
      listBucketsRoute,
      queryBucketRoute,
      summariseBucketRoute,
      getEventRoute,
      getAllowListRoute,
      replaceAllowListRoute,
      redriveEventRoute,
      purgeEventRoute,
      editPayloadRoute,
      viewApplicationOverviewRoute,
      viewApplicationEventsRoute,
      viewApplicationRawRoute,
      viewCaseOverviewRoute,
      viewCaseEventsRoute,
      viewCaseRawRoute,
      listGrantVersionsRoute,
      viewGrantVersionOverviewRoute,
      viewGrantVersionDefinitionRoute,
      viewGrantVersionPhasesRoute,
      fetchGrantDefinitionsRoute,
      viewWorkflowVersionsRoute,
      viewWorkflowVersionOverviewRoute,
      viewWorkflowVersionDefinitionRoute,
      viewWorkflowVersionRawRoute,
      fetchWorkflowDefinitionRoute,
    ]);
  },
};
