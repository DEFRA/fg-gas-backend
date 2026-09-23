import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementPaymentRequestedEvent } from "../agreements/events/agreement-payment-requested.event.js";
import { ClaimPaymentRequestedEvent } from "../grants/events/claim-payment-requested.event.js";
import { insertMany } from "./repositories/outbox.repository.js";
import { saveEvents } from "./save-events.js";

vi.mock("./repositories/outbox.repository.js");

const session = {};

const lifecyclePublication = {
  target: "agreement-status-topic",
  event: {
    type: "agreement.status.updated",
    data: { clientRef: "client", code: "pigs-might-fly" },
  },
};

const paymentPublication = {
  target: "create-payment-topic",
  segregationRef: "PMF823153883",
  event: {
    type: "io.onsite.agreement.create-payment",
    messageGroupId: "PMF823153883",
    data: { claimId: "R00000001", grants: [] },
  },
};

describe("saveEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives the segregation reference from the event data", async () => {
    await saveEvents([lifecyclePublication], session);

    const [entries] = insertMany.mock.calls[0];

    expect(entries[0].segregationRef).toBe("client-pigs-might-fly");
  });

  it("uses the publication's own segregation reference when it has one", async () => {
    await saveEvents([paymentPublication], session);

    const [entries] = insertMany.mock.calls[0];

    expect(entries[0]).toMatchObject({
      target: "create-payment-topic",
      segregationRef: "PMF823153883",
    });
  });

  it("uses the Agreement request's message group when source fields are nested", async () => {
    const event = new AgreementPaymentRequestedEvent({
      agreement: {
        agreementNumber: "AGR-1",
        version: 2,
        code: "woodland",
        configVersion: "1.28.2",
        correlationId: "correlation-1",
      },
      executedAt: "2026-09-14T13:11:01.000Z",
    });

    await saveEvents([{ event, target: "payment-requests-topic" }], session);

    expect(insertMany.mock.calls[0][0][0].segregationRef).toBe("AGR-1");
  });

  it("uses the Claim request's message group when source fields are nested", async () => {
    const event = new ClaimPaymentRequestedEvent({
      code: "woodland",
      clientRef: "WDL-1",
      clientClaimRef: "claim-1",
      entitlementId: "entitlement-1",
      configVersion: "1.28.2",
      agreement: {
        agreementNumber: "AGR-1",
        agreementVersion: 2,
        correlationId: "correlation-1",
      },
      executedAt: "2026-09-14T13:11:01.000Z",
      claim: { totalAmountPence: 150000 },
    });

    await saveEvents([{ event, target: "payment-requests-topic" }], session);

    expect(insertMany.mock.calls[0][0][0].segregationRef).toBe("WDL-1");
  });

  it("writes every publication in one insert", async () => {
    await saveEvents([lifecyclePublication, paymentPublication], session);

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany.mock.calls[0][0]).toHaveLength(2);
    expect(insertMany.mock.calls[0][1]).toBe(session);
  });

  it("writes nothing when there are no publications", async () => {
    await saveEvents([], session);

    expect(insertMany).not.toHaveBeenCalled();
  });
});
