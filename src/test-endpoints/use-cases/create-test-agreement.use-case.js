import Boom from "@hapi/boom";
import { randomUUID } from "node:crypto";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";
import { handleCreateAgreementCommandUseCase } from "../../agreements/use-cases/handle-create-agreement-command.use-case.js";

const INTERNAL_SERVER_ERROR = 500;

const assertManagedCode = (code) => {
  if (!config.managedAgreementGrantCodes.includes(code)) {
    throw Boom.badRequest(
      `Grant code "${code}" is not managed by GAS. Managed codes: ${config.managedAgreementGrantCodes.join(", ")}`,
    );
  }
};

// The creation mappings raise Boom.badImplementation (500) when the payload
// does not satisfy the grant's agreement definition, because in normal
// processing the input comes from a GAS-owned Application and a mismatch is a
// config fault. Here the input is supplied by the caller, so the same failure
// is reported as a bad request. A genuine config or infrastructure fault is
// reported the same way, so the original error is logged to keep it visible.
const toClientError = (error) => {
  if (error.isBoom && error.output.statusCode === INTERNAL_SERVER_ERROR) {
    logger.error(
      error,
      "Test agreement creation failed while applying the grant's agreement definition. Reported to the caller as a bad request.",
    );
    return Boom.badRequest(
      `Agreement could not be created from the supplied data: ${error.message}`,
    );
  }
  return error;
};

export const createTestAgreementUseCase = async (payload) => {
  assertManagedCode(payload.code);

  const command = {
    id: randomUUID(),
    type: internalCommandTypes.AGREEMENT_CREATE,
    data: payload,
  };

  try {
    return await handleCreateAgreementCommandUseCase(command);
  } catch (error) {
    throw toClientError(error);
  }
};
