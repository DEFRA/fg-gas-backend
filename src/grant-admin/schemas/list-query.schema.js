import Joi from "joi";
import {
  MAX_FILTER_VALUES,
  MAX_LINK_LENGTH,
  queryResponseSchema,
} from "../../common/buckets/schema.js";

const MAX_PAGES = 50;

const MAX_PARAMS = 30;
const MAX_KEY_LENGTH = 100;
const MAX_VALUE_LENGTH = 200;
const MAX_PATH_LENGTH = 200;

// A URL's value as typed, an empty one too: the address rules read it. Its
// length is counted by code point, as a stored error key is cut, and the
// query its list reads checks each fact's value as its own.
const typed = Joi.string()
  .allow("")
  .custom((text, helpers) =>
    Array.from(text).length > MAX_VALUE_LENGTH
      ? helpers.error("string.max", { limit: MAX_VALUE_LENGTH })
      : text,
  );

export const listQueryRequestSchema = Joi.object({
  path: Joi.string().max(MAX_PATH_LENGTH).required().example("events/gas"),
  params: Joi.object()
    .pattern(
      Joi.string().max(MAX_KEY_LENGTH),
      Joi.alternatives(typed, Joi.array().items(typed).max(MAX_FILTER_VALUES)),
    )
    .max(MAX_PARAMS)
    .default({}),
  search: Joi.string().max(MAX_LINK_LENGTH).allow(null).default(null),
  // Checked after the address, so an address refusal comes first.
  from: Joi.string().max(64),
  to: Joi.string().max(64),
  cursor: Joi.string().max(512),
  pages: Joi.number()
    .integer()
    .min(1)
    .max(MAX_PAGES)
    .default(1)
    .when("cursor", { is: Joi.exist(), then: Joi.valid(1) }),
  count: Joi.boolean(),
  repeat: Joi.boolean().default(false),
  read: Joi.boolean().default(true),
}).label("ListQueryRequest");

export const listQueryResponseSchema = Joi.object({
  bucket: Joi.string().required(),
  list: queryResponseSchema
    .keys({
      pageRows: Joi.array().items(Joi.number().integer().min(0)).required(),
      stopped: Joi.object({
        cursor: Joi.string().required(),
        statusCode: Joi.number().integer().required(),
        code: Joi.string().allow(null).required(),
        queue: Joi.string(),
      })
        .allow(null)
        .required(),
      refusedSearch: Joi.object({
        refusal: Joi.string().allow(null).required(),
      })
        .allow(null)
        .required(),
      // A list over several buckets: which of its queues ended a bounded
      // page, and which hold rows that wait behind them.
      queues: Joi.object({
        limited: Joi.array().items(Joi.string()).required(),
        waiting: Joi.array().items(Joi.string()).required(),
      }),
    })
    .allow(null)
    .required()
    .label("ListQueryList"),
}).label("ListQueryResponse");
