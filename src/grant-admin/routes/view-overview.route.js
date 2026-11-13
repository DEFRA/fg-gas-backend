import { apiClientHeadersSchema } from "../schemas/api-client.schema.js";
import { overviewResponseSchema } from "../schemas/overview.schema.js";
import { decodeActor } from "../services/actor-header.js";
import { callerHashOf, callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import { viewOverviewUseCase } from "../use-cases/view-overview.use-case.js";
import { buildOverviewView } from "../view-models/build-overview-view.js";

const LABEL = "View overview";

export const viewOverviewRoute = {
  method: "GET",
  path: "/grant-admin/overview",
  options: {
    description:
      "Admin: both services' dead letters of the last 24 hours, top errors among every current dead letter, failed config versions and expiring tokens, each part read on its own; kept for 60 seconds",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: apiClientHeadersSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: overviewResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: async (request) =>
    buildOverviewView(
      await viewOverviewUseCase({
        actor: request.headers["x-actor"],
        decodedActor: decodeActor(request.headers["x-actor"]),
        caller: callerOf(request),
        callerHash: callerHashOf(request),
      }),
    ),
};
