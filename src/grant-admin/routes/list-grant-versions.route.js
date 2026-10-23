import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  grantParamsSchema,
  grantVersionsSchema,
} from "../schemas/grant-version-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { listGrantVersionsUseCase } from "../use-cases/list-grant-versions.use-case.js";

export const listGrantVersionsRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/versions",
  options: recordPageRouteOptions({
    description: "Admin: a grant's versions, newest first, and its current one",
    label: "List grant versions",
    params: grantParamsSchema,
    headers: adminReadHeadersSchema,
    response: grantVersionsSchema,
  }),
  handler: (request) => listGrantVersionsUseCase(request.params),
};
