import { adminSearchHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  bucketQueryRequestSchema,
  bucketQueryResponseSchema,
} from "../schemas/bucket.schema.js";
import { bucketFailAction } from "../services/bucket-fail-action.js";
import { callerOf } from "../services/request-caller.js";
import { safeResponseFailAction } from "../services/safe-fail-action.js";
import { queryBucketUseCase } from "../use-cases/query-bucket.use-case.js";

const LABEL = "Query bucket";

// A POST, so a searched ref travels in the body and never in a logged URL.
export const queryBucketRoute = {
  method: "POST",
  path: "/grant-admin/buckets/{bucketId}/query",
  options: {
    description: "Admin: one page of one bucket, with the groups asked for",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: adminSearchHeadersSchema,
      payload: bucketQueryRequestSchema,
      failAction: bucketFailAction,
    },
    response: {
      schema: bucketQueryResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: (request) =>
    queryBucketUseCase({
      bucketId: request.params.bucketId,
      body: request.payload,
      caller: callerOf(request),
      actor: request.headers["x-actor"],
      repeat: request.headers["x-search-repeat"] === "1",
    }),
};
