import Joi from "joi";
import {
  catalogueEntrySchema,
  queryRequestSchema,
  queryResponseSchema,
  summaryRequestSchema,
  summaryResponseSchema,
} from "../../common/buckets/schema.js";
import { sourceErrorsSchema } from "./admin-record.schema.js";

export const bucketQueryRequestSchema =
  queryRequestSchema.label("BucketQueryRequest");

export const bucketQueryResponseSchema = queryResponseSchema.label(
  "BucketQueryResponse",
);

export const bucketSummaryRequestSchema = summaryRequestSchema.label(
  "BucketSummaryRequest",
);

export const bucketSummaryResponseSchema = summaryResponseSchema.label(
  "BucketSummaryResponse",
);

// Caseworking's entries are missing, and named in `sourceErrors`, when it cannot be read.
export const bucketCatalogueResponseSchema = Joi.object({
  buckets: Joi.array()
    .items(catalogueEntrySchema.label("BucketCatalogueEntry"))
    .required(),
  sourceErrors: sourceErrorsSchema,
}).label("BucketCatalogueResponse");
