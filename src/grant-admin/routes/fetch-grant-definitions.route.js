import { fetchConfigDefinitions } from "../../grants/services/config-version.service.js";
import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  fetchDefinitionsResponseSchema,
  grantVersionParamsSchema,
} from "../schemas/grant-version-page.schema.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";

const LABEL = "Fetch grant definitions";

export const fetchGrantDefinitionsRoute = {
  method: "POST",
  path: "/grant-admin/grants/{code}/versions/{version}/fetch",
  options: {
    description:
      "Admin: store each of a grant version's definition files GAS has not stored",
    tags: ["api"],
    validate: {
      params: grantVersionParamsSchema,
      headers: adminReadHeadersSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: fetchDefinitionsResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: (request) =>
    fetchConfigDefinitions({
      grantCode: request.params.code,
      version: request.params.version,
      caller: callerOf(request),
    }),
};
