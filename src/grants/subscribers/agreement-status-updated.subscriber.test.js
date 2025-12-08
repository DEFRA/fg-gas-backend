import { describe, expect, it, vi } from "vitest";
import { AgreementServiceStatus } from "../models/agreement.js";
import { saveInboxMessageUseCase } from "../use-cases/save-inbox-message.use-case.js";
import { agreementStatusUpdatedSubscriber } from "./agreement-status-updated.subscriber.js";

vi.mock("../use-cases/save-inbox-message.use-case.js");

describe("agreementStatusUpdatedSubscriber", () => {
  it("saves message to inbox", async () => {
    const mockMessage = {
      data: {
        clientRef: "test-client-ref",
        code: "test-code",
        agreementNumber: "AG123",
        date: "2024-01-01T00:00:00Z",
        status: AgreementServiceStatus.Offered,
      },
    };

    await agreementStatusUpdatedSubscriber.onMessage(mockMessage);

    expect(saveInboxMessageUseCase).toHaveBeenCalledWith(mockMessage, "AS");
  });
});
