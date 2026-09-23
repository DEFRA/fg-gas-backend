import { config } from "../common/config.js";
import { registerEventHandler } from "../events/index.js";
import { handleAgreementPaymentRequested } from "./handlers/handle-agreement-payment-requested.js";

// Keep identical to the producer-owned type in
// agreements/events/agreement-payment-requested.event.js without crossing the
// Agreements-to-Payments module boundary.
const AGREEMENT_PAYMENT_REQUESTED_EVENT_TYPE = `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.agreement.payment.requested`;

export const payments = {
  name: "payments",
  register() {
    registerEventHandler(
      AGREEMENT_PAYMENT_REQUESTED_EVENT_TYPE,
      handleAgreementPaymentRequested,
    );
  },
};
