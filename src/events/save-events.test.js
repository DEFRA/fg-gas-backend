import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementPaymentRequestedEvent } from "../agreements/events/agreement-payment-requested.event.js";
import { agreementStatusUpdated } from "../agreements/events/agreement-status-updated.event.js";
import { ClaimPaymentRequestedEvent } from "../grants/events/claim-payment-requested.event.js";
import { agreementCreatePayment } from "../payments/events/create-payment.event.js";
import { insertMany } from "./repositories/outbox.repository.js";
import { saveEvents } from "./save-events.js";

vi.mock("./repositories/outbox.repository.js");

const session = {};

const lifecyclePublication = {
  target: "agreement-status-topic",
  event: {
    id: "0b7c1d1e-0000-4000-8000-000000000001",
    type: agreementStatusUpdated.sentAs,
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    data: {
      clientRef: "CLIENT",
      code: "pigs-might-fly",
      agreementNumber: "PMF900000001",
    },
  },
};

const paymentPublication = {
  target: "create-payment-topic",
  segregationRef: "PMF900000001",
  event: {
    type: agreementCreatePayment.sentAs,
    messageGroupId: "PMF900000001",
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

    expect(entries[0].segregationRef).toBe("CLIENT-pigs-might-fly");
  });

  it("uses the publication's own segregation reference when it has one", async () => {
    await saveEvents([paymentPublication], session);

    const [entries] = insertMany.mock.calls[0];

    expect(entries[0]).toMatchObject({
      target: "create-payment-topic",
      segregationRef: "PMF900000001",
    });
  });

  it("uses the Agreement request's message group when source fields are nested", async () => {
    const event = new AgreementPaymentRequestedEvent({
      agreement: {
        agreementNumber: "AGR-1",
        version: 2,
        code: "woodland",
        configVersion: "1.39.1",
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
      configVersion: "1.39.1",
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

  it("stamps each row with its declared type, grant and refs", async () => {
    await saveEvents([lifecyclePublication], session);

    const [[entry]] = insertMany.mock.calls[0];

    expect(entry).toMatchObject({
      eventType: "AgreementStatusUpdated",
      refs: [
        "ref:client",
        "application:pigs-might-fly:~43.~4c.~49.~45.~4e.~54.",
        "id:0b7c1d1e-0000-4000-8000-000000000001",
        "trace:4bf92f3577b34da6a3ce929d0e0e4736",
      ],
    });
  });

  it("hands the event type the ordering key it stores on the row", async () => {
    const claimPayment = {
      ...paymentPublication,
      segregationRef: "WDL-1",
      event: {
        ...paymentPublication.event,
        data: { grants: [{ agreementNumber: "PMF900000001" }] },
      },
    };

    await saveEvents([claimPayment], session);

    expect(insertMany.mock.calls[0][0][0].refs).toEqual(["ref:wdl-1"]);
  });

  it("hands the event type the ordering key it derives when the publication has none", async () => {
    const derived = {
      target: "create-payment-topic",
      event: {
        type: agreementCreatePayment.sentAs,
        messageGroupId: "WDL-1",
        data: { grants: [{ agreementNumber: "PMF900000001" }] },
      },
    };

    await saveEvents([derived], session);

    expect(insertMany.mock.calls[0][0][0]).toMatchObject({
      segregationRef: "WDL-1",
      refs: ["ref:wdl-1"],
    });
  });

  it("adds the refs a publication takes from its aggregate after the type's own", async () => {
    await saveEvents(
      [
        {
          ...paymentPublication,
          segregationRef: "WDL-1",
          refs: [
            ["ref", "WDL-1"],
            ["application", "woodland:wdl-1"],
            ["application", null],
          ],
        },
      ],
      session,
    );

    expect(insertMany.mock.calls[0][0][0].refs).toEqual([
      "ref:wdl-1",
      "application:woodland:wdl-1",
    ]);
  });

  it("refuses an event whose type nobody declared", async () => {
    const undeclared = {
      target: "some-topic",
      segregationRef: "ref-1",
      event: { type: "cloud.defra.test.fg-gas-backend.no.such.type" },
    };

    await expect(saveEvents([undeclared], session)).rejects.toThrow(
      'Event type "cloud.defra.test.fg-gas-backend.no.such.type" is not declared',
    );
    expect(insertMany).not.toHaveBeenCalled();
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
