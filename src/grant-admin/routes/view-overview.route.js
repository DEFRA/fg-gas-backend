import { logger } from "../../common/logger.js";
import { apiClientHeadersSchema } from "../schemas/api-client.schema.js";
import {
  fitsOverviewPart,
  overviewResponseSchema,
} from "../schemas/overview.schema.js";
import { decodeActor } from "../services/actor-header.js";
import { OVERVIEW_BUDGET_MS } from "../services/overview-reads.js";
import { callerHashOf, callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import { viewOverviewUseCase } from "../use-cases/view-overview.use-case.js";
import {
  buildOverviewView,
  shapePart,
} from "../view-models/build-overview-view.js";
import { SHELL_ALWAYS, answersShell } from "../services/shell-tag.js";

const LABEL = "View overview";

const checks = {
  fits: fitsOverviewPart,
  malformed: (part, service) =>
    logger.warn(`Overview ${part} of ${service} not shaped: malformed rows`),
};

// Checked as it is read, so the cache keeps a part that cannot be shaped as
// failed, and reads it again.
const checkPart = (part, service, read, window) => {
  const shaped = shapePart(part, service, read, window, checks);

  return shaped.data === null ? shaped : read;
};

export const viewOverviewRoute = {
  method: "GET",
  path: "/grant-admin/overview",
  options: {
    ...answersShell(SHELL_ALWAYS, OVERVIEW_BUDGET_MS),
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
      await viewOverviewUseCase(
        {
          actor: request.headers["x-actor"],
          decodedActor: decodeActor(request.headers["x-actor"]),
          caller: callerOf(request),
          callerHash: callerHashOf(request),
        },
        checkPart,
      ),
    ),
};
