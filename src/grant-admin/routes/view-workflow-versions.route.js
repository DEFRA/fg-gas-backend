import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  workflowParamsSchema,
  workflowVersionsSchema,
} from "../schemas/workflow-version-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { listWorkflowVersionsUseCase } from "../use-cases/list-workflow-versions.use-case.js";

export const viewWorkflowVersionsRoute = {
  method: "GET",
  path: "/grant-admin/workflows/{code}/versions",
  options: recordPageRouteOptions({
    description:
      "Admin: a Caseworking workflow's versions, newest first, and its current one",
    label: "List workflow versions",
    params: workflowParamsSchema,
    headers: adminReadHeadersSchema,
    response: workflowVersionsSchema,
  }),
  handler: (request) =>
    listWorkflowVersionsUseCase({
      code: request.params.code,
      actor: request.headers["x-actor"],
    }),
};
