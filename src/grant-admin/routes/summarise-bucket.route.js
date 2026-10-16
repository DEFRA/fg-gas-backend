import { adminSearchHeadersSchema } from "../schemas/actor-header.schema.js";
import {
  bucketSummaryRequestSchema,
  bucketSummaryResponseSchema,
} from "../schemas/bucket.schema.js";
import { bucketFailAction } from "../services/bucket-fail-action.js";
import { safeResponseFailAction } from "../services/safe-fail-action.js";
import { summariseBucketUseCase } from "../use-cases/summarise-bucket.use-case.js";

const LABEL = "Summarise bucket";

export const summariseBucketRoute = {
  method: "POST",
  path: "/grant-admin/buckets/{bucketId}/summaries/{summaryId}",
  options: {
    description: "Admin: one summary a bucket declares, most frequent first",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: adminSearchHeadersSchema,
      payload: bucketSummaryRequestSchema,
      failAction: bucketFailAction,
    },
    response: {
      schema: bucketSummaryResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: (request) =>
    summariseBucketUseCase({
      bucketId: request.params.bucketId,
      summaryId: request.params.summaryId,
      body: request.payload,
      actor: request.headers["x-actor"],
    }),
};
