import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  grantVersionPageSchemas,
  grantVersionParamsSchema,
} from "../schemas/grant-version-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { callerOf } from "../services/request-caller.js";
import { viewGrantVersionPageUseCase } from "../use-cases/view-grant-version-page.use-case.js";

export const viewGrantVersionPhasesRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/versions/{version}/phases",
  options: recordPageRouteOptions({
    description: "Admin: one grant version's phases tab",
    label: "View grant version",
    params: grantVersionParamsSchema,
    headers: adminReadHeadersSchema,
    response: grantVersionPageSchemas.phases,
  }),
  handler: (request) =>
    viewGrantVersionPageUseCase({
      ...request.params,
      tab: "phases",
      caller: callerOf(request),
    }),
};
