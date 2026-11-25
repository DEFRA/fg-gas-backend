import {
  getGrantSettingsRoute,
  saveGrantSettingsRoute,
} from "./routes/grant-settings.route.js";
import { requireAdminClient } from "./admin-client.js";
import {
  changeApiTokenExpiryRoute,
  deleteApiTokenRoute,
  issueApiTokenRoute,
  listApiTokensRoute,
  revokeApiTokenRoute,
  rotateApiTokenRoute,
} from "./routes/api-clients.route.js";
import { createEntitlementRoute } from "./routes/create-entitlement.route.js";
import { editPayloadRoute } from "./routes/edit-payload.route.js";
import { exploreQueryRoute } from "./routes/explore-query.route.js";
import { exploreVocabularyRoute } from "./routes/explore-vocabulary.route.js";
import { getClaimRoute } from "./routes/get-claim.route.js";
import { getClaimsRoute } from "./routes/get-claims.route.js";
import { getEntitlementRoute } from "./routes/get-entitlement.route.js";
import { getEventRoute } from "./routes/get-event.route.js";
import { getEventStatusRoute } from "./routes/get-event-status.route.js";
import { getAllowListRoute } from "./routes/get-allow-list.route.js";
import { fetchGrantDefinitionsRoute } from "./routes/fetch-grant-definitions.route.js";
import { fetchWorkflowDefinitionRoute } from "./routes/fetch-workflow-definition.route.js";
import { listGrantTypesRoute } from "./routes/list-grant-types.route.js";
import { listGrantVersionsRoute } from "./routes/list-grant-versions.route.js";
import { listBucketsRoute } from "./routes/list-buckets.route.js";
import { purgeEventRoute } from "./routes/purge-event.route.js";
import { queryBucketRoute } from "./routes/query-bucket.route.js";
import { queryListRoute } from "./routes/query-list.route.js";
import { summariseBucketRoute } from "./routes/summarise-bucket.route.js";
import { viewApplicationEventsRoute } from "./routes/view-application-events.route.js";
import { viewApplicationOverviewRoute } from "./routes/view-application-overview.route.js";
import { viewApplicationRawRoute } from "./routes/view-application-raw.route.js";
import { redriveEventRoute } from "./routes/redrive-event.route.js";
import { replaceAllowListRoute } from "./routes/replace-allow-list.route.js";
import { viewCaseEventsRoute } from "./routes/view-case-events.route.js";
import { viewCaseOverviewRoute } from "./routes/view-case-overview.route.js";
import { viewCaseRawRoute } from "./routes/view-case-raw.route.js";
import { viewGrantVersionAgreementRoute } from "./routes/view-grant-version-agreement.route.js";
import { viewGrantVersionDefinitionRoute } from "./routes/view-grant-version-definition.route.js";
import { viewGrantVersionEntitlementsRoute } from "./routes/view-grant-version-entitlements.route.js";
import { viewGrantVersionEventsRoute } from "./routes/view-grant-version-events.route.js";
import { viewGrantVersionOverviewRoute } from "./routes/view-grant-version-overview.route.js";
import { viewGrantVersionPhasesRoute } from "./routes/view-grant-version-phases.route.js";
import { viewGrantVersionPaymentRoute } from "./routes/view-grant-version-payment.route.js";
import { viewWorkflowVersionDefinitionRoute } from "./routes/view-workflow-version-definition.route.js";
import { viewWorkflowVersionEventsRoute } from "./routes/view-workflow-version-events.route.js";
import { viewWorkflowVersionOverviewRoute } from "./routes/view-workflow-version-overview.route.js";
import { viewWorkflowVersionPhasesRoute } from "./routes/view-workflow-version-phases.route.js";
import { viewWorkflowVersionRawRoute } from "./routes/view-workflow-version-raw.route.js";
import { viewHomeRoute } from "./routes/view-home.route.js";
import { viewOverviewRoute } from "./routes/view-overview.route.js";
import { viewShellRoute } from "./routes/view-shell.route.js";
import { viewWorkflowVersionsRoute } from "./routes/view-workflow-versions.route.js";
import { updateEntitlementRoute } from "./routes/update-entitlement.route.js";
import { setAuditActor } from "./set-audit-actor.js";
import { addShell, startShell } from "./shell.js";

export const grantAdmin = {
  name: "grant-admin",
  register(server) {
    // Every route here answers the admin frontend alone; sandboxed to this plugin.
    server.ext("onPostAuth", requireAdminClient, { sandbox: "plugin" });
    server.ext("onPostAuth", setAuditActor, { sandbox: "plugin" });
    server.ext("onPostAuth", startShell, { sandbox: "plugin" });
    server.ext("onPreResponse", addShell, { sandbox: "plugin" });

    server.route([
      getClaimsRoute,
      getClaimRoute,
      getEntitlementRoute,
      createEntitlementRoute,
      updateEntitlementRoute,
      viewOverviewRoute,
      viewShellRoute,
      listBucketsRoute,
      queryBucketRoute,
      queryListRoute,
      summariseBucketRoute,
      exploreQueryRoute,
      exploreVocabularyRoute,
      getEventRoute,
      getEventStatusRoute,
      getAllowListRoute,
      getGrantSettingsRoute,
      saveGrantSettingsRoute,
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
      viewHomeRoute,
      listGrantTypesRoute,
      listGrantVersionsRoute,
      viewGrantVersionOverviewRoute,
      viewGrantVersionDefinitionRoute,
      viewGrantVersionPhasesRoute,
      viewGrantVersionPaymentRoute,
      viewGrantVersionAgreementRoute,
      viewGrantVersionEntitlementsRoute,
      viewGrantVersionEventsRoute,
      fetchGrantDefinitionsRoute,
      viewWorkflowVersionsRoute,
      viewWorkflowVersionOverviewRoute,
      viewWorkflowVersionDefinitionRoute,
      viewWorkflowVersionPhasesRoute,
      viewWorkflowVersionEventsRoute,
      viewWorkflowVersionRawRoute,
      fetchWorkflowDefinitionRoute,
      listApiTokensRoute,
      issueApiTokenRoute,
      revokeApiTokenRoute,
      deleteApiTokenRoute,
      changeApiTokenExpiryRoute,
      rotateApiTokenRoute,
    ]);
  },
};
