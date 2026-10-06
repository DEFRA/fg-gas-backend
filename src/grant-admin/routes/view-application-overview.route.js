import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  applicationPageSchemas,
  applicationParamsSchema,
} from "../schemas/application-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { callerOf } from "../services/request-caller.js";
import { viewApplicationPageUseCase } from "../use-cases/view-application-page.use-case.js";

export const viewApplicationOverviewRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/applications/{clientRef}/overview",
  options: recordPageRouteOptions({
    description: "Admin: one application's overview tab",
    label: "View application",
    params: applicationParamsSchema,
    headers: adminReadHeadersSchema,
    response: applicationPageSchemas.overview,
  }),
  handler: (request) =>
    viewApplicationPageUseCase({
      ...request.params,
      tab: "overview",
      caller: callerOf(request),
    }),
};
