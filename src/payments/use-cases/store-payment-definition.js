import { insertPaymentDefinition } from "../repositories/payment-definition.repository.js";
import { compilePaymentDefinition } from "./compile-payment-definition.js";

// An operator's Fetch Definitions: the file is held to the check it met on arrival, then
// stored as published. No fetch status is written.
export const storePaymentDefinition = async (
  { grantCode, version, definition },
  session,
) => {
  compilePaymentDefinition(definition, grantCode);
  await insertPaymentDefinition(
    { code: grantCode, version, definition },
    session,
  );
};
