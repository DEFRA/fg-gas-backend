import {
  exploreHeadersSchema,
  exploreQueryRequestSchema,
  exploreQueryResponseSchema,
} from "../schemas/explore.schema.js";
import { clientGoneSignal } from "../services/client-gone.js";
import { callerOf } from "../services/request-caller.js";
import { SHELL_ALWAYS, answersShell } from "../services/shell-tag.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import { exploreQueryUseCase } from "../use-cases/explore-query.use-case.js";

const LABEL = "Explore query";

// A POST, so a query and what it searches for travel in the body, never in a
// logged URL.
export const exploreQueryRoute = {
  method: "POST",
  path: "/grant-admin/explore/query",
  options: {
    ...answersShell(SHELL_ALWAYS),
    description:
      "Admin: one Explore query, or its check. `windows: N` reads windows 1 to N in turn as one answer, with the rows of each in `windowRows` and a later window that failed in `stopped`; the answer or refusal carries the editor's vocabulary, as GET /grant-admin/explore/vocabulary answers it",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: exploreHeadersSchema,
      payload: exploreQueryRequestSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: exploreQueryResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: (request) =>
    exploreQueryUseCase({
      body: request.payload,
      actorId: request.headers["x-actor-id"],
      actor: request.headers["x-actor"],
      roles: request.headers["x-actor-roles"],
      caller: callerOf(request),
      signal: clientGoneSignal(request),
    }),
};
