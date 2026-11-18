import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  workflowVersionPageSchemas,
  workflowVersionParamsSchema,
} from "../schemas/workflow-version-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { callerOf } from "../services/request-caller.js";
import { viewWorkflowVersionPageUseCase } from "../use-cases/view-workflow-version-page.use-case.js";

export const viewWorkflowVersionOverviewRoute = {
  method: "GET",
  path: "/grant-admin/workflows/{code}/versions/{version}/overview",
  options: recordPageRouteOptions({
    description:
      "Admin: one Caseworking workflow version's overview tab, with its own events (versionEvents) read beside it within 1.5 seconds: read with any source errors, timed-out or failed",
    label: "View workflow version",
    params: workflowVersionParamsSchema,
    headers: adminReadHeadersSchema,
    response: workflowVersionPageSchemas.overview,
  }),
  handler: (request) =>
    viewWorkflowVersionPageUseCase({
      ...request.params,
      tab: "overview",
      caller: callerOf(request),
      actor: request.headers["x-actor"],
    }),
};
