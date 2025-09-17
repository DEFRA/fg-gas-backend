import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";
import { caseStatusUpdatedSubscriber } from "./case-status-updated.subscriber.js";
vi.mock("../use-cases/approve-application.use-case.js");
vi.mock("../repositories/application.repository.js");

describe("caseStatusUpdatedSubscriber", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("approves the application when current status is 'APPROVED' and status has changed", async () => {
    const mockMessage = {
      data: {
        caseRef: "test-client-ref",
        workflowCode: "grant-1",
        currentStatus: "APPROVED",
      },
    };

    await caseStatusUpdatedSubscriber.onMessage(mockMessage);
    expect(approveApplicationUseCase).toHaveBeenCalledWith(mockMessage.data);
  });

  it("does not approve the application when current status is not 'APPROVED'", async () => {
    const mockMessage = {
      data: {
        clientRef: "test-client-ref",
        currentStatus: "PROCESSING",
      },
    };

    await caseStatusUpdatedSubscriber.onMessage(mockMessage);
    expect(approveApplicationUseCase).not.toHaveBeenCalled();
  });
});
