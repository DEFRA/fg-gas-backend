import { findConfigDefinition } from "../../common/config-broker/config-catalog.repository.js";
import { resolvePaymentDefinition } from "./resolve-payment-definition.js";

const definitionType = "payment";

const isConfigured = async ({ code, configVersion }) =>
  Boolean(
    await findConfigDefinition({
      grantCode: code,
      version: configVersion,
      definitionType,
    }),
  );

export const resolveClaimPayment = async ({ code, configVersion, claim }) => {
  if (!configVersion || !(await isConfigured({ code, configVersion }))) {
    return null;
  }

  return resolvePaymentDefinition({
    code,
    configVersion,
    context: {
      claim,
      execution: { executedAt: new Date().toISOString() },
    },
  });
};
