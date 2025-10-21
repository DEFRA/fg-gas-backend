import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyExternalStateChange } from "../use-cases/apply-event-status-change.service.js";
import { caseStatusUpdatedSubscriber } from "./case-status-updated.subscriber.js";

vi.mock("../use-cases/apply-event-status-change.service.js");

describe("case status updated subscriber", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should apply external state change with correct parameters", async () => {
    const message = {
      data: {
        caseRef: "TEST-CASE-123",
        currentStatus: "APPROVED",
      },
    };
    await caseStatusUpdatedSubscriber.onMessage(message);
    expect(applyExternalStateChange).toHaveBeenCalledWith({
      sourceSystem: "CW",
      clientRef: "TEST-CASE-123",
      externalRequestedState: "APPROVED",
      eventData: message.data,
    });
  });

  it("should apply external state change for withdrawn status", async () => {
    const message = {
      data: {
        caseRef: "TEST-CASE-456",
        currentStatus: "WITHDRAWN",
      },
    };
    await caseStatusUpdatedSubscriber.onMessage(message);
    expect(applyExternalStateChange).toHaveBeenCalledWith({
      sourceSystem: "CW",
      clientRef: "TEST-CASE-456",
      externalRequestedState: "WITHDRAWN",
      eventData: message.data,
    });
  });
});
