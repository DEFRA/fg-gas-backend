import Boom from "@hapi/boom";
import { PaymentDefinition } from "../models/payment-definition.js";

// Also the seam for checking a published definition before it is recorded: building the
// model is the check, and it throws on anything Payments cannot use.
export const compilePaymentDefinition = (rawDefinition, code) => {
  const definition = new PaymentDefinition(rawDefinition);

  if (definition.code !== code) {
    throw Boom.badImplementation(
      `Payment definition code "${definition.code}" does not match "${code}"`,
    );
  }

  return definition;
};
