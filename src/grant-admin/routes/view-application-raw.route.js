import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  applicationPageSchemas,
  applicationParamsSchema,
} from "../schemas/application-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { callerOf } from "../services/request-caller.js";
import { viewApplicationPageUseCase } from "../use-cases/view-application-page.use-case.js";

export const viewApplicationRawRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/applications/{clientRef}/raw",
  options: recordPageRouteOptions({
    description: "Admin: one application's raw tab",
    label: "View application",
    params: applicationParamsSchema,
    headers: adminReadHeadersSchema,
    response: applicationPageSchemas.raw,
  }),
  handler: (request) =>
    viewApplicationPageUseCase({
      ...request.params,
      tab: "raw",
      caller: callerOf(request),
    }),
};
