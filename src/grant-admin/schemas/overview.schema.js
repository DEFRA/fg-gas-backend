import Joi from "joi";
import { apiTokenSchema } from "./api-client.schema.js";

const isoDate = Joi.string().isoDate();

const count = {
  count: Joi.number().integer().min(0).required(),
  capped: Joi.boolean().required(),
};

const listLink = Joi.object({
  path: Joi.string().required(),
  query: Joi.object().pattern(Joi.string(), Joi.string()).required(),
});

const sourceError = Joi.object({
  hop: Joi.string().valid("GAS", "CW-BE").required(),
  reason: Joi.string()
    .valid("UNREACHABLE", "TIMED_OUT", "ERRORED", "NOT_OFFERED")
    .required(),
});

// Read, or the reason it was not: never both, never neither.
const part = (data) =>
  Joi.alternatives().try(
    Joi.object({
      data: data.required(),
      sourceError: Joi.valid(null).required(),
    }),
    Joi.object({
      data: Joi.valid(null).required(),
      sourceError: sourceError.required(),
    }),
  );

const perService = (data) =>
  Joi.object({ gas: part(data).required(), cw: part(data).required() });

const deadLetters = Joi.object({
  ...count,
  bars: Joi.array()
    .items(
      Joi.object({
        from: isoDate.required(),
        to: isoDate.required(),
        ...count,
      }),
    )
    .required(),
  lists: Joi.array()
    .items(
      Joi.object({
        box: Joi.string().required(),
        ...count,
        list: listLink.required(),
      }),
    )
    .required(),
});

const topErrors = Joi.object({
  entries: Joi.array()
    .items(
      Joi.object({
        errorKey: Joi.string().allow("", null).required(),
        event: Joi.object({
          value: Joi.string().required(),
          label: Joi.string().allow("").required(),
        })
          .allow(null)
          .required(),
        ...count,
        lastAt: isoDate.allow(null).required(),
        list: listLink.required(),
      }),
    )
    .required(),
  more: Joi.boolean().required(),
  complete: Joi.boolean().required(),
});

const configFailed = Joi.object({
  versions: Joi.array()
    .items(
      Joi.object({
        code: Joi.string().required(),
        version: Joi.string().required(),
        definition: Joi.string()
          .valid("permanent_error", "transient_error")
          .required(),
        receivedAt: isoDate.allow(null).required(),
      }),
    )
    .required(),
  more: Joi.boolean().required(),
});

const tokensExpiring = Joi.object({
  withinDays: Joi.number().integer().min(1).required(),
  tokens: Joi.array().items(apiTokenSchema).required(),
});

export const overviewResponseSchema = Joi.object({
  at: isoDate.required(),
  window: Joi.object({
    from: isoDate.required(),
    to: isoDate.required(),
  }).required(),
  countCap: Joi.number().integer().min(1).required(),
  deadLetters: perService(deadLetters).required(),
  topErrors: perService(topErrors).required(),
  configFailed: perService(configFailed).required(),
  tokensExpiring: perService(tokensExpiring).required(),
}).label("Overview");
