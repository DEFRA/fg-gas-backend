import { adminSearchHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  searchCasesRequestSchema,
  searchCasesResponseSchema,
} from "../schemas/search-cases.schema.js";
import { callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import { searchCasesUseCase } from "../use-cases/search-cases.use-case.js";

const LABEL = "Search cases";

// A POST, so a searched ref travels in the body and never in a logged URL.
export const searchCasesRoute = {
  method: "POST",
  path: "/grant-admin/cases/search",
  options: {
    description:
      "Admin: one page of Caseworking cases, newest first, or every case in a ref's series",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: adminSearchHeadersSchema,
      payload: searchCasesRequestSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: searchCasesResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler(request) {
    const query = request.payload ?? {};

    return searchCasesUseCase({
      ...query,
      caller: callerOf(request),
      actor: request.headers["x-actor"],
      // Only a first page can be a repeated search.
      repeat: !query.cursor && request.headers["x-search-repeat"] === "1",
    });
  },
};
