import { getGrantAllowList } from "../../grants/services/allow-list.service.js";
import {
  adminReadHeadersSchema,
  claimsHeadersSchema,
} from "../schemas/actor-header.schema.js";
import { userRolesOf } from "../services/claims-access.js";
import {
  allowListParamsSchema,
  allowListResponseSchema,
} from "../schemas/allow-list.schema.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";

const LABEL = "View allow list";

export const getAllowListRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/allow-list",
  options: {
    description: "Admin: view the global allow list for one grant",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      params: allowListParamsSchema,
      headers: adminReadHeadersSchema.concat(claimsHeadersSchema),
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: allowListResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: (request) =>
    getGrantAllowList({
      grantCode: request.params.code,
      caller: callerOf(request),
      userRoles: userRolesOf(request),
    }),
};
