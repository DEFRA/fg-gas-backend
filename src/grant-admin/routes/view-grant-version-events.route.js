import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  grantVersionPageSchemas,
  grantVersionParamsSchema,
} from "../schemas/grant-version-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { callerOf } from "../services/request-caller.js";
import { viewGrantVersionPageUseCase } from "../use-cases/view-grant-version-page.use-case.js";

export const viewGrantVersionEventsRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/versions/{version}/events",
  options: recordPageRouteOptions({
    description: "Admin: one grant version's events tab",
    label: "View grant version",
    params: grantVersionParamsSchema,
    headers: adminReadHeadersSchema,
    response: grantVersionPageSchemas.events,
  }),
  handler: (request) =>
    viewGrantVersionPageUseCase({
      ...request.params,
      tab: "events",
      caller: callerOf(request),
    }),
};
