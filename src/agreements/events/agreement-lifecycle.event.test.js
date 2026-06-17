import { describe, expect, it } from "vitest";
import { AgreementLifecycleEvent } from "./agreement-lifecycle.event.js";

const createLifecycleEventData = (overrides = {}) => ({
  eventId: "version-id",
  agreementId: "agreement-id",
  agreementVersionId: "version-id",
  agreementItemId: "agreement-item-id",
  agreementNumber: "PMF123456789",
  agreementCode: "agreement-code",
  code: "pigs-might-fly",
  clientRef: "PMF-APP-001",
  changedAt: "2026-06-01T10:00:00.000Z",
  status: "offered",
  date: "2026-06-01T10:00:00.000Z",
  startDate: undefined,
  endDate: undefined,
  claimId: undefined,
  ...overrides,
});

describe("AgreementLifecycleEvent", () => {
  it("wraps created Agreement lifecycle event data in a CloudEvent", () => {
    const data = createLifecycleEventData();
    const event = new AgreementLifecycleEvent(data);

    expect(event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.created",
    );
    expect(event.source).toBe("AS");
    expect(event.data).toBe(data);
    expect(event.messageGroupId).toBe("PMF-APP-001-pigs-might-fly");
  });

  it("uses the accepted event type for accepted Agreement lifecycle data", () => {
    const event = new AgreementLifecycleEvent(
      createLifecycleEventData({
        status: "accepted",
      }),
    );

    expect(event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.accepted",
    );
  });
});
