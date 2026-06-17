import { describe, expect, it, vi } from "vitest";
import { Agreement } from "../models/agreement.js";
import { createAgreementLifecycleEventData } from "./agreement-lifecycle-event-data.js";

describe("Agreement lifecycle event data", () => {
  it("describes the Agreement item lifecycle state from the Agreement version", () => {
    const agreement = Agreement.fromDocument({
      _id: "agreement-id",
      agreementNumber: "PMF123456789",
      code: "pigs-might-fly",
      items: [
        {
          agreementItemId: "agreement-item-id",
          clientRef: "PMF-APP-001",
        },
      ],
    });
    const item = agreement.items[0];
    const version = {
      id: "version-id",
      createdAt: "2026-06-01T10:00:00.000Z",
      findItemState: vi.fn().mockReturnValue({
        claimId: "R00000001",
        payment: {
          agreementStartDate: "2026-07-01",
          agreementEndDate: "2027-06-30",
        },
        status: "accepted",
      }),
    };

    expect(
      createAgreementLifecycleEventData({
        agreement,
        item,
        version,
      }),
    ).toEqual({
      eventId: "version-id",
      agreementId: "agreement-id",
      agreementVersionId: "version-id",
      agreementItemId: "agreement-item-id",
      agreementNumber: "PMF123456789",
      agreementCode: "pigs-might-fly",
      code: "pigs-might-fly",
      clientRef: "PMF-APP-001",
      changedAt: "2026-06-01T10:00:00.000Z",
      status: "accepted",
      date: "2026-06-01T10:00:00.000Z",
      startDate: "2026-07-01",
      endDate: "2027-06-30",
      claimId: "R00000001",
    });
    expect(version.findItemState).toHaveBeenCalledWith("agreement-item-id");
  });
});
