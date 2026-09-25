import { afterEach, expect, it, vi } from "vitest";
import { AGREEMENT_PAYMENT_REQUESTED_EVENT_TYPE } from "../agreements/events/agreement-payment-requested.event.js";
import {
  clearEventHandlers,
  dispatchEvent,
} from "../events/services/event-handlers.js";
import { CLAIM_PAYMENT_REQUESTED_EVENT_TYPE } from "../grants/events/claim-payment-requested.event.js";
import { handleAgreementPaymentRequested } from "./handlers/handle-agreement-payment-requested.js";
import { handleClaimPaymentRequested } from "./handlers/handle-claim-payment-requested.js";
import { payments } from "./index.js";

vi.mock("./handlers/handle-agreement-payment-requested.js", () => ({
  handleAgreementPaymentRequested: vi.fn(),
}));
vi.mock("./handlers/handle-claim-payment-requested.js", () => ({
  handleClaimPaymentRequested: vi.fn(),
}));

afterEach(() => {
  clearEventHandlers();
  vi.clearAllMocks();
});

it("registers against the producer-owned Agreement payment request type", async () => {
  payments.register();
  const message = { type: AGREEMENT_PAYMENT_REQUESTED_EVENT_TYPE };

  await dispatchEvent(message);

  expect(handleAgreementPaymentRequested).toHaveBeenCalledWith(message);
});

it("registers against the producer-owned Claim payment request type", async () => {
  payments.register();
  const message = { type: CLAIM_PAYMENT_REQUESTED_EVENT_TYPE };

  await dispatchEvent(message);

  expect(handleClaimPaymentRequested).toHaveBeenCalledWith(message);
});
