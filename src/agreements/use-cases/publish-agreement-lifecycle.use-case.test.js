import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { Outbox } from "../../grants/models/outbox.js";
import {
  existsByEventId,
  insertMany,
} from "../../grants/repositories/outbox.repository.js";
import { Agreement } from "../models/agreement.js";
import { publishAgreementLifecycle } from "./publish-agreement-lifecycle.use-case.js";

vi.mock("../../grants/repositories/outbox.repository.js");

describe("publish agreement lifecycle", () => {
  const createLifecycleChange = () => {
    const agreement = Agreement.fromDocument({
      _id: "agreement-id",
      agreementNumber: "PMF123456789",
      sbi: "123456789",
      items: [
        {
          agreementItemId: "agreement-item-id",
          agreementCode: "pigs-might-fly",
          clientRef: "PMF-APP-001",
        },
      ],
    });
    const item = agreement.items[0];
    const version = {
      id: "version-id",
      createdAt: "2026-06-01T10:00:00.000Z",
      change: {
        type: "created",
        changedBy: "system",
        fromStatus: null,
      },
      findItemState: vi.fn().mockReturnValue({
        status: "offered",
        payment: null,
      }),
    };

    return { agreement, item, version };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    existsByEventId.mockResolvedValue(false);
  });

  it("publishes the Agreement lifecycle event for a version change", async () => {
    const lifecycleChange = createLifecycleChange();

    await publishAgreementLifecycle(lifecycleChange, "session");

    expect(insertMany).toHaveBeenCalledWith([expect.any(Outbox)], "session");

    const outbox = insertMany.mock.calls[0][0][0];
    expect(outbox.target).toBe(config.sns.agreementStatusUpdatedTopicArn);
    expect(outbox.event.type).toBe(
      "cloud.defra.local.fg-gas-backend.agreement.created",
    );
    expect(outbox.event.source).toBe("AS");
    expect(lifecycleChange.version.findItemState).toHaveBeenCalledWith(
      "agreement-item-id",
    );
    expect(outbox.event.data).toEqual({
      eventId: "version-id",
      agreementId: "agreement-id",
      agreementVersionId: "version-id",
      agreementItemId: "agreement-item-id",
      agreementNumber: "PMF123456789",
      agreementCode: "pigs-might-fly",
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
    });
  });

  it("does not duplicate an Agreement lifecycle event already in the outbox", async () => {
    const lifecycleChange = createLifecycleChange();
    existsByEventId.mockResolvedValue(true);

    await publishAgreementLifecycle(lifecycleChange, "session");

    expect(existsByEventId).toHaveBeenCalledWith("version-id", "session");
    expect(insertMany).not.toHaveBeenCalled();
  });
});
