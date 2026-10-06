import Joi from "joi";
import {
  listPaginationSchema,
  listRequestSchema,
} from "./admin-list.schema.js";
import {
  listTotalSchema,
  nullableIso,
  positionSchema,
  sourceErrorsSchema,
} from "./admin-record.schema.js";

export const searchApplicationsRequestSchema = listRequestSchema(
  "code",
  "SearchApplicationsRequest",
);

const applicationRowSchema = Joi.object({
  ref: Joi.object({
    clientRef: Joi.string().required(),
    code: Joi.string().required(),
  }).required(),
  position: positionSchema,
  createdAt: nullableIso,
  // A later application in the same grant's series replaced this one.
  replaced: Joi.boolean().required(),
}).label("ApplicationRow");

export const searchApplicationsResponseSchema = Joi.object({
  rows: Joi.array().items(applicationRowSchema).required(),
  pagination: listPaginationSchema.required(),
  total: listTotalSchema,
  // The Grant menu, on a first page only.
  codes: Joi.array().items(Joi.string()).optional(),
  sourceErrors: sourceErrorsSchema,
}).label("SearchApplicationsResponse");
