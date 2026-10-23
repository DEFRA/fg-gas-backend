import { afterEach, expect, it, vi } from "vitest";
import {
  clearDefinitionStores,
  storeDefinition,
  storedDefinitionVersions,
} from "../common/config-broker/definition-stores.js";
import { AGREEMENT_PAYMENT_REQUESTED_EVENT_TYPE } from "../agreements/events/agreement-payment-requested.event.js";
import {
  clearEventHandlers,
  dispatchEvent,
} from "../events/services/event-handlers.js";
import { CLAIM_PAYMENT_REQUESTED_EVENT_TYPE } from "../grants/events/claim-payment-requested.event.js";
import { handleAgreementPaymentRequested } from "./handlers/handle-agreement-payment-requested.js";
import { handleClaimPaymentRequested } from "./handlers/handle-claim-payment-requested.js";
import { payments } from "./index.js";
import { findStoredVersions } from "./repositories/payment-definition.repository.js";
import { storePaymentDefinition } from "./use-cases/store-payment-definition.js";

vi.mock("./handlers/handle-agreement-payment-requested.js", () => ({
  handleAgreementPaymentRequested: vi.fn(),
}));
vi.mock("./repositories/payment-definition.repository.js");
vi.mock("./use-cases/store-payment-definition.js");
vi.mock("./handlers/handle-claim-payment-requested.js", () => ({
  handleClaimPaymentRequested: vi.fn(),
}));

afterEach(() => {
  clearEventHandlers();
  clearDefinitionStores();
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

it("registers the payment definition store's stored-version read", async () => {
  findStoredVersions.mockResolvedValue(["1.0.1"]);
  payments.register();

  await expect(
    storedDefinitionVersions("payment", "woodland", ["1.0.1"], {
      id: "transaction",
    }),
  ).resolves.toEqual(new Set(["1.0.1"]));
  expect(findStoredVersions).toHaveBeenCalledWith("woodland", ["1.0.1"], {
    id: "transaction",
  });
});

it("registers the payment definition store's check-and-store", async () => {
  payments.register();
  const file = { grantCode: "woodland", version: "1.0.1", definition: {} };
  const session = { id: "transaction" };

  await storeDefinition("payment", file, session);

  expect(storePaymentDefinition).toHaveBeenCalledWith(file, session);
});
