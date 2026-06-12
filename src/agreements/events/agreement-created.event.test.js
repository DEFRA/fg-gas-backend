import { describe, expect, it } from "vitest";
import { AgreementCreatedEvent } from "./agreement-created.event.js";

describe("AgreementCreatedEvent", () => {
  it("wraps Agreement lifecycle event data in a CloudEvent", () => {
    const data = {
      eventId: "version-id",
      agreementId: "agreement-id",
      agreementVersionId: "version-id",
      agreementItemId: "agreement-item-id",
      agreementNumber: "PMF123456789",
      agreementCode: "agreement-code",
      code: "pigs-might-fly",
      clientRef: "PMF-APP-001",
      changeType: "created",
      changedAt: "2026-06-01T10:00:00.000Z",
      changedBy: "system",
      fromStatus: null,
      toStatus: "offered",
      status: "offered",
      date: "2026-06-01T10:00:00.000Z",
      startDate: undefined,
      endDate: undefined,
      claimId: undefined,
    };

    const event = new AgreementCreatedEvent(data);

    expect(event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.created",
    );
    expect(event.source).toBe("AS");
    expect(event.data).toBe(data);
    expect(event.messageGroupId).toBe("PMF-APP-001-pigs-might-fly");
  });
});
