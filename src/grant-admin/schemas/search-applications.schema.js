import Joi from "joi";
import { clientRef } from "../../common/schemas/client-ref.js";
import { code } from "./code.js";
import {
  assertRange,
  listPaginationSchema,
  rangeBound,
} from "./admin-list.schema.js";
import {
  listTotalSchema,
  nullableIso,
  positionSchema,
  sourceErrorsSchema,
} from "./admin-record.schema.js";

const REF_MAX = 100;
const CURSOR_MAX = 512;

export const searchApplicationsRequestSchema = Joi.object({
  ref: clientRef
    .trim()
    .lowercase()
    .max(REF_MAX)
    .empty("")
    .optional()
    .example("gld-9b2-bws"),
  code: code.optional(),
  from: rangeBound().optional().example("2026-06-16T00:00:00.000Z"),
  to: rangeBound().optional().example("2026-06-16T23:59:59.999Z"),
  cursor: Joi.string().max(CURSOR_MAX).optional(),
})
  // A ref search is one page: there is nothing after it to continue to.
  .nand("ref", "cursor")
  .custom(assertRange)
  .messages({ "any.invalid": '"from" must be earlier than or equal to "to"' })
  .label("SearchApplicationsRequest");

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
