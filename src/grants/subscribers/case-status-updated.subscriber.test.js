import { describe, expect, it, vi } from "vitest";
import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";
import { findApplicationByClientRefUseCase } from "../use-cases/find-application-by-client-ref.use-case.js";
import { caseStatusUpdatedSubscriber } from "./case-status-updated.subscriber.js";

vi.mock("../use-cases/approve-application.use-case.js");
vi.mock("../use-cases/find-application-by-client-ref.use-case.js");

describe("caseStatusUpdatedSubscriber", () => {
  it("approves the application when current status is 'APPROVED' and status has changed", async () => {
    const mockApplication = {
      currentStatus: "PRE_AWARD:APPLICATION:RECEIVED",
    };

    const mockMessage = {
      data: {
        clientRef: "test-client-ref",
        currentStatus: "PRE_AWARD:APPLICATION:APPROVED",
      },
    };

    findApplicationByClientRefUseCase.mockResolvedValue(mockApplication);

    await caseStatusUpdatedSubscriber.onMessage(mockMessage);

    expect(findApplicationByClientRefUseCase).toHaveBeenCalledWith(
      "test-client-ref",
    );
    expect(approveApplicationUseCase).toHaveBeenCalledWith(mockMessage.data);
  });

  it("does not approve the application when current status is not 'APPROVED'", async () => {
    const mockApplication = {
      currentStatus: "PRE_AWARD:APPLICATION:RECEIVED",
    };

    const mockMessage = {
      data: {
        clientRef: "test-client-ref",
        currentStatus: "PRE_AWARD:APPLICATION:PROCESSING",
      },
    };

    findApplicationByClientRefUseCase.mockResolvedValue(mockApplication);

    await caseStatusUpdatedSubscriber.onMessage(mockMessage);

    expect(findApplicationByClientRefUseCase).toHaveBeenCalledWith(
      "test-client-ref",
    );
    expect(approveApplicationUseCase).not.toHaveBeenCalled();
  });

  it("does not approve the application when status changed to 'APPROVED' but was already 'APPROVED'", async () => {
    const mockApplication = {
      currentStatus: "PRE_AWARD:APPLICATION:APPROVED",
    };

    const mockMessage = {
      data: {
        clientRef: "test-client-ref",
        currentStatus: "PRE_AWARD:APPLICATION:APPROVED",
      },
    };

    findApplicationByClientRefUseCase.mockResolvedValue(mockApplication);

    await caseStatusUpdatedSubscriber.onMessage(mockMessage);

    expect(findApplicationByClientRefUseCase).toHaveBeenCalledWith(
      "test-client-ref",
    );
    expect(approveApplicationUseCase).not.toHaveBeenCalled();
  });
});
