import { loadPaymentDefinition } from "./load-payment-definition.js";

export const preparePayment = async ({ code, configVersion, context }) => {
  const definition = await loadPaymentDefinition({ code, configVersion });
  return definition.resolve(context);
};
