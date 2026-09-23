import { logger } from "../../common/logger.js";
import { loadPaymentDefinition } from "./load-payment-definition.js";

export const resolvePaymentDefinition = async ({
  code,
  configVersion,
  context,
}) => {
  const definition = await loadPaymentDefinition({ code, configVersion });

  try {
    return await definition.resolve(context);
  } catch (error) {
    logger.error(
      { error, event: { action: "payment-mapping-failed" } },
      `Payment mapping failed for ${code}@${configVersion}`,
    );
    throw error;
  }
};
