import Joi from "joi";
import { code } from "../schemas/grant/code.js";
import { submitApplicationRequestSchema } from "../schemas/requests/submit-application-request.schema.js";
import { submitApplicationUseCase } from "../use-cases/submit-application.use-case.js";

export const submitApplicationRoute = {
  method: "POST",
  path: "/grants/{code}/applications",
  options: {
    description: "Submit an application for a grant",
    tags: ["api"],
    validate: {
      payload: submitApplicationRequestSchema,
      params: Joi.object({
        code,
      }),
    },
  },
  async handler(request, h) {
    await submitApplicationUseCase(request.params.code, request.payload);

    return h.response().code(204);
  },
};
