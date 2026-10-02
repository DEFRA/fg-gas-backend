import { adminSearchHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  searchApplicationsRequestSchema,
  searchApplicationsResponseSchema,
} from "../schemas/search-applications.schema.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import {
  modeOf,
  searchApplicationsUseCase,
} from "../use-cases/search-applications.use-case.js";

const LABEL = "Search applications";

// A POST, so a searched ref travels in the body and never in a logged URL.
export const searchApplicationsRoute = {
  method: "POST",
  path: "/grant-admin/applications/search",
  options: {
    description:
      "Admin: one page of applications, newest first, or every application in a ref's series",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: adminSearchHeadersSchema,
      payload: searchApplicationsRequestSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: searchApplicationsResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  async handler(request) {
    const query = request.payload ?? {};

    const page = await searchApplicationsUseCase({
      ...query,
      caller: callerOf(request),
      repeat: request.headers["x-search-repeat"] === "1",
    });

    // Bulk browsing shows here without naming anyone; the audit says who.
    request.metrics.counter("adminListPages", 1, {
      list: "applications",
      mode: modeOf(query),
    });

    return page;
  },
};
