import Joi from "joi";
import { code } from "../schemas/grant/code.js";
import { referenceDataName } from "../schemas/grant/reference-data.js";
import { getReferenceDataResponseSchema } from "../schemas/responses/get-reference-data-response.schema.js";
import { getReferenceDataUseCase } from "../use-cases/get-reference-data.use-case.js";

export const getReferenceDataRoute = {
  method: "GET",
  path: "/grants/{code}/reference/{name}",
  options: {
    description:
      "Get the items of a reference data set the grant's current version declares",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code: code.required(),
        name: referenceDataName.required(),
      }),
    },
    response: {
      status: {
        200: getReferenceDataResponseSchema,
      },
    },
  },
  handler: (request) => getReferenceDataUseCase(request.params),
};
