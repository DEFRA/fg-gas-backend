import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertMany } from "../grants/repositories/outbox.repository.js";
import { saveOutboxEvents } from "./save-outbox-events.js";

vi.mock("../grants/repositories/outbox.repository.js");

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

describe("saveOutboxEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives the segregation reference from the event data", async () => {
    await saveOutboxEvents([lifecyclePublication], session);

    const [entries] = insertMany.mock.calls[0];

    expect(entries[0].segregationRef).toBe("client-pigs-might-fly");
  });

  it("uses the publication's own segregation reference when it has one", async () => {
    await saveOutboxEvents([paymentPublication], session);

    const [entries] = insertMany.mock.calls[0];

    expect(entries[0]).toMatchObject({
      target: "create-payment-topic",
      segregationRef: "PMF823153883",
    });
  });

  it("writes every publication in one insert", async () => {
    await saveOutboxEvents([lifecyclePublication, paymentPublication], session);

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany.mock.calls[0][0]).toHaveLength(2);
    expect(insertMany.mock.calls[0][1]).toBe(session);
  });

  it("writes nothing when there are no publications", async () => {
    await saveOutboxEvents([], session);

    expect(insertMany).not.toHaveBeenCalled();
  });
});
