import { getGrantAllowList } from "../../grants/services/allow-list.service.js";
import {
  adminReadHeadersSchema,
  claimsHeadersSchema,
} from "../schemas/actor-header.schema.js";
import { userRolesOf } from "../services/claims-access.js";
import { allowListParamsSchema } from "../schemas/allow-list-params.schema.js";
import { allowListViewSchema } from "../schemas/allow-list-view.schema.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import { buildAllowListView } from "../view-models/build-allow-list-view.js";

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
      schema: allowListViewSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  async handler(request) {
    const allowList = await getGrantAllowList({
      grantCode: request.params.code,
      caller: callerOf(request),
      userRoles: userRolesOf(request),
    });

    return buildAllowListView({ allowList });
  },
};
