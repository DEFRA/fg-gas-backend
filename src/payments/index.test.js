import { afterEach, expect, it } from "vitest";
import { AGREEMENT_PAYMENT_REQUESTED_EVENT_TYPE } from "../agreements/events/agreement-payment-requested.event.js";
import {
  clearEventHandlers,
  hasEventHandler,
} from "../events/services/event-handlers.js";
import { payments } from "./index.js";

afterEach(clearEventHandlers);

it("registers against the producer-owned Agreement payment request type", () => {
  payments.register();

  expect(hasEventHandler(AGREEMENT_PAYMENT_REQUESTED_EVENT_TYPE)).toBe(true);
});
