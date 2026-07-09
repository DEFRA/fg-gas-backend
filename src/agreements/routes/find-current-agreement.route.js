import { logger } from "../../common/logger.js";
import { findCurrentAgreementQuerySchema } from "../schemas/requests/find-current-agreement-query.schema.js";
import { findCurrentAgreementResponseSchema } from "../schemas/responses/find-current-agreement-response.schema.js";
import { findCurrentAgreementUseCase } from "../use-cases/find-current-agreement.use-case.js";

export const findCurrentAgreementRoute = {
  method: "GET",
  path: "/agreements/current",
  options: {
    description: "Find the current agreement by code, client reference and SBI",
    tags: ["api"],
    validate: {
      query: findCurrentAgreementQuerySchema,
    },
    response: {
      schema: findCurrentAgreementResponseSchema,
    },
  },
  async handler(request, _h) {
    const { code, clientRef, sbi } = request.query;
    logger.info(`Finding current agreement for code ${code}`);
    const agreement = await findCurrentAgreementUseCase({
      code,
      clientRef,
      sbi,
    });
    logger.info(`Finished: Finding current agreement for code ${code}`);
    return agreement;
  },
};
