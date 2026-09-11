import Boom from "@hapi/boom";
import { randomUUID } from "node:crypto";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";
import { handleUpdateAgreementStatusCommandUseCase } from "../../agreements/use-cases/handle-update-agreement-status-command.use-case.js";
import { loadCurrentAgreementByNumber } from "../../agreements/use-cases/load-current-agreement.js";

const CONFLICT = 409;

const assertManagedCode = (agreement) => {
  if (!config.managedAgreementGrantCodes.includes(agreement.code)) {
    throw Boom.badRequest(
      `Agreement "${agreement.agreementNumber}" has grant code "${agreement.code}", which is not managed by GAS`,
    );
  }
};

// handleUpdateAgreementStatusCommandUseCase is written for the queue consumer,
// where an illegal transition is logged and swallowed so the message is not
// retried forever. It returns undefined in that case. Over HTTP a silent 200
// would hide the rejection, so the absence of a result is translated into a
// conflict that reports the state the Agreement is still in.
const rejectedTransition = async ({ agreementNumber, status }) => {
  const current = await loadCurrentAgreementByNumber({ agreementNumber });

  return new Boom.Boom(
    `Agreement "${agreementNumber}" cannot transition to "${status}" from "${current.state}"`,
    {
      statusCode: CONFLICT,
      data: {
        agreementNumber,
        currentState: current.state,
        requestedStatus: status,
      },
    },
  );
};

export const updateTestAgreementStatusUseCase = async ({
  agreementNumber,
  status,
}) => {
  logger.info(
    `Updating test agreement ${agreementNumber} to status ${status}`,
  );

  // Throws Boom.notFound when the Agreement does not exist, which gives the
  // 404 before anything is dispatched.
  const agreement = await loadCurrentAgreementByNumber({ agreementNumber });
  assertManagedCode(agreement);

  const command = {
    id: randomUUID(),
    type: internalCommandTypes.AGREEMENT_STATUS_UPDATE,
    data: {
      agreementNumber,
      clientRef: agreement.clientRef,
      code: agreement.code,
      status,
    },
  };
  const result = await handleUpdateAgreementStatusCommandUseCase(command);

  if (!result) {
    throw await rejectedTransition({ agreementNumber, status });
  }

  // The command handler returns a redirect location on success and a version
  // snapshot when the command was already applied, so neither is the updated
  // Agreement. Re-read it to report the state that was actually persisted.
  const updatedAgreement = await loadCurrentAgreementByNumber({
    agreementNumber,
  });

  logger.info(
    `Finished: Updating test agreement ${agreementNumber} to status ${status}`,
  );

  return updatedAgreement;
};
