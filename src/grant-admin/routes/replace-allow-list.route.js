import { replaceGrantAllowList } from "../../grants/services/allow-list.service.js";
import {
  adminReadHeadersSchema,
  claimsHeadersSchema,
} from "../schemas/actor-header.schema.js";
import { userRolesOf } from "../services/claims-access.js";
import {
  allowListParamsSchema,
  allowListResponseSchema,
  replaceAllowListRequestSchema,
} from "../schemas/allow-list.schema.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";

const LABEL = "Replace allow list";

export const replaceAllowListRoute = {
  method: "PUT",
  path: "/grant-admin/grants/{code}/allow-list",
  options: {
    description: "Admin: replace the global allow list for one grant",
    tags: ["api"],
    validate: {
      params: allowListParamsSchema,
      headers: adminReadHeadersSchema.concat(claimsHeadersSchema),
      payload: replaceAllowListRequestSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: allowListResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: (request) =>
    replaceGrantAllowList({
      grantCode: request.params.code,
      global: request.payload.global,
      caller: callerOf(request),
      userRoles: userRolesOf(request),
    }),
};
