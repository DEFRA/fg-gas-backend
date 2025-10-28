import { describe, expect, it, vi } from "vitest";
import { saveInboxMessageUseCase } from "../use-cases/save-inbox-message.use-case.js";
import { caseStatusUpdatedSubscriber } from "./case-status-updated.subscriber.js";
vi.mock("../use-cases/save-inbox-message.use-case.js");

describe("case status updated subscriber", () => {
  it("should save message to inbox", async () => {
    const message = {
      data: {
        caseRef: "TEST-CASE-123",
        currentStatus: "APPROVED",
      },
    };
    await caseStatusUpdatedSubscriber.onMessage(message);
    expect(saveInboxMessageUseCase).toHaveBeenCalledWith(message);
  });
});
