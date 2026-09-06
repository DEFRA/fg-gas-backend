import { updateDefinitionFetchStatus } from "../../common/config-broker/config-catalog.repository.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { logger } from "../../common/logger.js";
import { loadPaymentDefinition } from "./load-payment-definition.js";

const definitionType = "payment";

const recordFailureStatus = async (code, configVersion, error) => {
  try {
    await updateDefinitionFetchStatus({
      grantCode: code,
      version: configVersion,
      definitionType,
      fetchStatus: FetchStatus.PermanentError,
      fetchError: error.message,
    });
  } catch (statusError) {
    logger.error(
      {
        error: statusError,
        event: { action: "payment-definition-status-update-failed" },
      },
      `Payment definition status update failed for ${code}@${configVersion}`,
    );
  }
};

export const resolvePaymentDefinition = async ({
  code,
  configVersion,
  context,
}) => {
  const definition = await loadPaymentDefinition({ code, configVersion });

  try {
    return await definition.resolve(context);
  } catch (error) {
    await recordFailureStatus(code, configVersion, error);
    logger.error(
      { error, event: { action: "payment-definition-resolve-failed" } },
      `Payment definition resolution failed for ${code}@${configVersion}`,
    );
    throw error;
  }
};
