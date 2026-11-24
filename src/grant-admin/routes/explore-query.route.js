import {
  exploreHeadersSchema,
  exploreQueryRequestSchema,
  exploreQueryResponseSchema,
} from "../schemas/explore.schema.js";
import { clientGoneSignal } from "../services/client-gone.js";
import { SHELL_ALWAYS, answersShell } from "../services/shell-tag.js";
import {
  checkedResponse,
  safeFailAction,
} from "../services/safe-fail-action.js";
import { exploreQueryUseCase } from "../use-cases/explore-query.use-case.js";

const LABEL = "Explore query";

// An answer is checked before it is sent; a streamed download, written
// line by line, is sent as it is.
const checked = checkedResponse(exploreQueryResponseSchema, LABEL);

const NDJSON = "application/x-ndjson";

// A POST, so a query and what it searches for travel in the body, never in a
// logged URL.
export const exploreQueryRoute = {
  method: "POST",
  path: "/grant-admin/explore/query",
  options: {
    ...answersShell(SHELL_ALWAYS),
    description:
      "Admin: one Explore query, or its check. `windows: N` reads windows 1 to N in turn as one answer, with the rows of each in `windowRows` and a later window that failed in `stopped`; the answer or refusal carries the editor's vocabulary, as GET /grant-admin/explore/vocabulary answers it. `documents: true` adds each row's document as stored (base64 BSON). With `csv`, `documents` and `stream`, the download is streamed as application/x-ndjson: a header line, a line a row, and an end line; a refusal comes before the first byte, as JSON",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: exploreHeadersSchema,
      payload: exploreQueryRequestSchema,
      failAction: safeFailAction(LABEL),
    },
  },
  handler: async (request, h) => {
    const answer = await exploreQueryUseCase({
      body: request.payload,
      actorId: request.headers["x-actor-id"],
      actor: request.headers["x-actor"],
      signal: clientGoneSignal(request),
    });

    return answer.stream
      ? h.response(answer.stream).type(NDJSON)
      : checked(answer);
  },
};
