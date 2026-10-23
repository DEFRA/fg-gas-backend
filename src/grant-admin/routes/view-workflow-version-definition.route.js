import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  workflowVersionPageSchemas,
  workflowVersionParamsSchema,
} from "../schemas/workflow-version-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { callerOf } from "../services/request-caller.js";
import { viewWorkflowVersionPageUseCase } from "../use-cases/view-workflow-version-page.use-case.js";

export const viewWorkflowVersionDefinitionRoute = {
  method: "GET",
  path: "/grant-admin/workflows/{code}/versions/{version}/definition",
  options: recordPageRouteOptions({
    description: "Admin: one Caseworking workflow version's definition tab",
    label: "View workflow version",
    params: workflowVersionParamsSchema,
    headers: adminReadHeadersSchema,
    response: workflowVersionPageSchemas.definition,
  }),
  handler: (request) =>
    viewWorkflowVersionPageUseCase({
      ...request.params,
      tab: "definition",
      caller: callerOf(request),
      actor: request.headers["x-actor"],
    }),
};
