import Joi from "joi";
import {
  getGrantSettings,
  saveGrantSettings,
} from "../../grants/services/grant-settings.service.js";
import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import { allowListParamsSchema } from "../schemas/allow-list-params.schema.js";
import { findOperatorRoles } from "../services/operator-roles.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";

const responseSchema = Joi.object({
  grantCode: Joi.string().required(),
  open: Joi.boolean().strict().required(),
});
const LABEL = "Grant settings";
const validate = {
  params: allowListParamsSchema,
  headers: adminReadHeadersSchema,
  failAction: safeFailAction(LABEL),
};
const response = {
  schema: responseSchema,
  failAction: safeResponseFailAction(LABEL),
};
const argsOf = (request) => ({
  grantCode: request.params.code,
  caller: callerOf(request),
  findUserRoles: findOperatorRoles,
});

export const getGrantSettingsRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/settings",
  options: {
    description: "Admin: view grant settings",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate,
    response,
  },
  handler: (request) => getGrantSettings(argsOf(request)),
};

export const saveGrantSettingsRoute = {
  method: "PUT",
  path: "/grant-admin/grants/{code}/settings",
  options: {
    description: "Admin: save grant settings",
    tags: ["api"],
    validate: {
      ...validate,
      payload: Joi.object({ open: Joi.boolean().strict().required() }).unknown(
        false,
      ),
    },
    response,
  },
  handler: (request) =>
    saveGrantSettings({
      ...argsOf(request),
      open: request.payload.open,
    }),
};
