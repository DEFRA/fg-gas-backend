import { bucketCatalogueResponseSchema } from "../schemas/bucket.schema.js";
import { safeResponseFailAction } from "../services/safe-fail-action.js";
import { listBucketsUseCase } from "../use-cases/list-buckets.use-case.js";

const LABEL = "List buckets";

export const listBucketsRoute = {
  method: "GET",
  path: "/grant-admin/buckets",
  options: {
    description:
      "Admin: every list the portal can show, with its filters, groupings and columns",
    tags: ["api"],
    response: {
      schema: bucketCatalogueResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: () => listBucketsUseCase(),
};
