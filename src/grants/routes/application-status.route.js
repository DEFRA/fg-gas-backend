import Joi from "joi";
import { clientRef } from "../schemas/application/metadata/client-ref.js";
import { code } from "../schemas/grant/code.js";
import { applicationStatusResponseSchema } from "../schemas/responses/application-status-response.schema.js";
import { getApplicationStatusUseCase } from "../use-cases/get-application-status.use-case.js";

export const applicationStatusRoute = {
  method: "GET",
  path: "/grants/{code}/applications/{clientRef}/status",
  options: {
    description: "Get application status",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code,
        clientRef,
      }),
    },
    response: {
      schema: applicationStatusResponseSchema,
    },
  },
  async handler(request) {
    const { code, clientRef } = request.params;
    const applicationStatusData = await getApplicationStatusUseCase({
      clientRef,
      code,
    });

    return applicationStatusData;
  },
};
