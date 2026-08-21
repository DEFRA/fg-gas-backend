import { createDefinitionLoader } from "../../common/config-broker/definition-loader.js";
import { PaymentDefinition } from "../models/payment-definition.js";

// Payments resolves the exact version it is asked for and never falls back.
// Agreements passes its own resolved config version, so the pair always
// resolves together; independent fallback could pair an Agreement at one
// version with a Payment Definition at another. See docs/MODULE_BOUNDARIES.md.
const loader = createDefinitionLoader({
  definitionType: "payment",
  label: "Payment",
  compile: (raw, identity) => new PaymentDefinition(raw, identity),
});

export const loadPaymentDefinition = ({ code, configVersion }) =>
  loader.load({ code, configVersion, resolution: "exact" });

export const clearPaymentDefinitionCaches = loader.clearCaches;
