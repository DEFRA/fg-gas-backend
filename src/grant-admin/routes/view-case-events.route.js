import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  casePageSchemas,
  caseParamsSchema,
} from "../schemas/case-page.schema.js";
import { recordPageRouteOptions } from "../services/record-page-route.js";
import { callerOf } from "../services/request-caller.js";
import { viewCasePageUseCase } from "../use-cases/view-case-page.use-case.js";

export const viewCaseEventsRoute = {
  method: "GET",
  path: "/grant-admin/workflows/{workflowCode}/cases/{caseRef}/events",
  options: recordPageRouteOptions({
    description: "Admin: one Caseworking case's events tab",
    label: "View case",
    params: caseParamsSchema,
    headers: adminReadHeadersSchema,
    response: casePageSchemas.events,
  }),
  handler: (request) =>
    viewCasePageUseCase({
      ...request.params,
      tab: "events",
      caller: callerOf(request),
      actor: request.headers["x-actor"],
    }),
};
