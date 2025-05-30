import { describe, expect, it, vi } from "vitest";
import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";
import { caseStageUpdatedSubscriber } from "./case-stage-updated.subscriber.js";

vi.mock("../use-cases/approve-application.use-case.js");

describe("caseStageUpdatedSubscriber", () => {
  it("approves the application when current stage is 'contract'", async () => {
    const mockMessage = {
      data: {
        currentStage: "contract",
        caseRef: "test-client-ref",
      },
    };

    await caseStageUpdatedSubscriber.onMessage(mockMessage);

    expect(approveApplicationUseCase).toHaveBeenCalledWith("test-client-ref");
  });

  it("does not approve the application when current stage is not 'contract'", async () => {
    const mockMessage = {
      data: {
        currentStage: "other-stage",
        caseRef: "test-client-ref",
      },
    };

    await caseStageUpdatedSubscriber.onMessage(mockMessage);

    expect(approveApplicationUseCase).not.toHaveBeenCalled();
  });
});
