import Boom from "@hapi/boom";
import { replaceGrantAllowList } from "../../grants/services/allow-list.service.js";
import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import { allowListParamsSchema } from "../schemas/allow-list-params.schema.js";
import { allowListViewSchema } from "../schemas/allow-list-view.schema.js";
import { replaceAllowListRequestSchema } from "../schemas/replace-allow-list-request.schema.js";
import { findOperatorRoles } from "../services/operator-roles.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import {
  buildAllowListView,
  parseAllowListForm,
} from "../view-models/build-allow-list-view.js";

const LABEL = "Replace allow list";
const BAD_REQUEST_STATUS_CODE = 400;

const isAllowListValidationFailure = (error) =>
  Boom.isBoom(error) &&
  error.output.payload.errorCode === "ALLOW_LIST_VALIDATION_FAILED" &&
  error.output.payload.details !== undefined;

export const replaceAllowListRoute = {
  method: "PUT",
  path: "/grant-admin/grants/{code}/allow-list",
  options: {
    description: "Admin: replace the global allow list for one grant",
    tags: ["api"],
    validate: {
      params: allowListParamsSchema,
      headers: adminReadHeadersSchema,
      payload: replaceAllowListRequestSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: allowListViewSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  async handler(request, h) {
    const { global } = parseAllowListForm(request.payload);

    try {
      const allowList = await replaceGrantAllowList({
        grantCode: request.params.code,
        global,
        caller: callerOf(request),
        findUserRoles: findOperatorRoles,
      });

      return buildAllowListView({ allowList });
    } catch (error) {
      if (!isAllowListValidationFailure(error)) {
        throw error;
      }

      const view = buildAllowListView({
        submitted: request.payload,
        details: error.output.payload.details,
      });

      return h.response(view).code(BAD_REQUEST_STATUS_CODE);
    }
  },
};
