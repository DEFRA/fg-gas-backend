import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  workflowFetchDefinitionsResponseSchema,
  workflowVersionParamsSchema,
} from "../schemas/workflow-version-page.schema.js";
import { decodeActor } from "../services/actor-header.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import { fetchWorkflowDefinitionUseCase } from "../use-cases/fetch-workflow-definition.use-case.js";

const LABEL = "Fetch workflow definition";

export const fetchWorkflowDefinitionRoute = {
  method: "POST",
  path: "/grant-admin/workflows/{code}/versions/{version}/fetch",
  options: {
    description:
      "Admin: ask Caseworking to store a workflow version's definition it has not stored",
    tags: ["api"],
    validate: {
      params: workflowVersionParamsSchema,
      headers: adminReadHeadersSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: workflowFetchDefinitionsResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: (request) =>
    fetchWorkflowDefinitionUseCase({
      code: request.params.code,
      version: request.params.version,
      caller: callerOf(request),
      actor: decodeActor(request.headers["x-actor"]),
    }),
};
