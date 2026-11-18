import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  workflowVersionPageSchemas,
  workflowVersionParamsSchema,
} from "../schemas/workflow-version-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { callerOf } from "../services/request-caller.js";
import { viewWorkflowVersionPageUseCase } from "../use-cases/view-workflow-version-page.use-case.js";

export const viewWorkflowVersionPhasesRoute = {
  method: "GET",
  path: "/grant-admin/workflows/{code}/versions/{version}/phases",
  options: recordPageRouteOptions({
    description:
      "Admin: one Caseworking workflow version's phases tab: its definition, and what GAS does with the statuses it sends as the grant of the same code and version says (grantStatusMap: found with the grant's lifecycle, no-grant, not-stored, unreadable or unavailable; null beside no definition). The grant is read only beside a definition, and audited as a view of its Phases tab",
    label: "View workflow version",
    params: workflowVersionParamsSchema,
    headers: adminReadHeadersSchema,
    response: workflowVersionPageSchemas.phases,
  }),
  handler: (request) =>
    viewWorkflowVersionPageUseCase({
      ...request.params,
      tab: "phases",
      caller: callerOf(request),
      actor: request.headers["x-actor"],
    }),
};
