import Joi from "joi";

export const getReferenceDataResponseSchema = Joi.object({
  name: Joi.string().required(),
  source: Joi.string().valid("inline", "db", "endpoint").required(),
  items: Joi.array()
    .items(
      Joi.object({
        code: Joi.string().required(),
        description: Joi.string().required(),
      }),
    )
    .required(),
}).label("GetReferenceDataResponse");
