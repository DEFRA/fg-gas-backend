import Joi from "joi";
import {
  listPaginationSchema,
  listRequestSchema,
  listTotalSchema,
  nullableIso,
  positionSchema,
  sourceErrorsSchema,
} from "./admin-record.schema.js";

export const searchCasesRequestSchema = listRequestSchema(
  "workflowCode",
  "SearchCasesRequest",
);

const caseRowSchema = Joi.object({
  ref: Joi.object({
    caseRef: Joi.string().required(),
    workflowCode: Joi.string().required(),
  }).required(),
  position: positionSchema,
  closed: Joi.boolean().allow(null).required(),
  closedAt: nullableIso,
  createdAt: nullableIso,
}).label("CaseRow");

export const searchCasesResponseSchema = Joi.object({
  rows: Joi.array().items(caseRowSchema).required(),
  pagination: listPaginationSchema,
  total: listTotalSchema,
  // The Workflow menu, on a first page only.
  workflowCodes: Joi.array().items(Joi.string()).optional(),
  sourceErrors: sourceErrorsSchema,
}).label("SearchCasesResponse");
