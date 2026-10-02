import Joi from "joi";
import { clientRef } from "../../common/schemas/client-ref.js";
import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import { applicationPageSchemas } from "../schemas/application-page.schema.js";
import { code } from "../schemas/code.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import {
  APPLICATION_TABS,
  viewApplicationPageUseCase,
} from "../use-cases/view-application-page.use-case.js";

const applicationParamsSchema = Joi.object({
  code,
  clientRef,
}).label("ApplicationParams");

const applicationPageRoute = (tab) => ({
  method: "GET",
  path: `/grant-admin/grants/{code}/applications/{clientRef}/${tab}`,
  options: {
    description: `Admin: one application's ${tab} tab`,
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      params: applicationParamsSchema,
      headers: adminReadHeadersSchema,
      failAction: safeFailAction("View application"),
    },
    response: {
      schema: applicationPageSchemas[tab],
      failAction: safeResponseFailAction("View application"),
    },
  },
  handler: (request) =>
    viewApplicationPageUseCase({
      code: request.params.code,
      clientRef: request.params.clientRef,
      tab,
      caller: callerOf(request),
    }),
});

export const applicationPageRoutes =
  Object.keys(APPLICATION_TABS).map(applicationPageRoute);
