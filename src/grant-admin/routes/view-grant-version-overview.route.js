import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  grantVersionPageSchemas,
  grantVersionParamsSchema,
} from "../schemas/grant-version-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { callerOf } from "../services/request-caller.js";
import { viewGrantVersionPageUseCase } from "../use-cases/view-grant-version-page.use-case.js";

export const viewGrantVersionOverviewRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/versions/{version}/overview",
  options: recordPageRouteOptions({
    description:
      "Admin: one grant version's overview tab, with its own events (versionEvents) read beside it within 1.5 seconds: read with any source errors, timed-out or failed",
    label: "View grant version",
    params: grantVersionParamsSchema,
    headers: adminReadHeadersSchema,
    response: grantVersionPageSchemas.overview,
  }),
  handler: (request) =>
    viewGrantVersionPageUseCase({
      ...request.params,
      tab: "overview",
      caller: callerOf(request),
    }),
};
