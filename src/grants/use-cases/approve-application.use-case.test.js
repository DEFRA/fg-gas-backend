import { describe, expect, it, vi } from "vitest";
import {
  publishApplicationApprovedEvent,
  publishCreateAgreementCommand,
} from "../publishers/application-event.publisher.js";
import {
  findByClientRef,
  update,
} from "../repositories/application.repository.js";
import { approveApplicationUseCase } from "./approve-application.use-case.js";

vi.mock("../publishers/application-event.publisher.js");
vi.mock("../repositories/application.repository.js");
vi.mock("./update-application.use-case.js");

describe("approveApplicationUseCase", () => {
  it("publishes application approved event", async () => {
    const mockApplication = {
      clientRef: "test-client-ref",
      code: "test-grant",
      answers: { question1: "answer1" },
      currentPhase: "phase1",
      currentStage: "stage1",
      currentStatus: "RECEIVED",
    };

    findByClientRef.mockResolvedValue(mockApplication);

    await approveApplicationUseCase({ clientRef: "test-client-ref" });

    expect(findByClientRef).toHaveBeenCalledWith("test-client-ref");

    expect(update).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "test-grant",
      answers: { question1: "answer1" },
      currentPhase: "phase1",
      currentStage: "stage1",
      currentStatus: "APPROVED",
    });

    expect(publishApplicationApprovedEvent).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "test-grant",
      previousStatus: "phase1:stage1:RECEIVED",
      currentStatus: "phase1:stage1:APPROVED",
    });

    expect(publishCreateAgreementCommand).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "test-grant",
      answers: { question1: "answer1" },
      currentPhase: "phase1",
      currentStage: "stage1",
      currentStatus: "APPROVED",
    });
  });

  it("throws when application is not found", async () => {
    findByClientRef.mockRejectedValue(
      new Error("Application not found for clientRef: non-existent-client-ref"),
    );

    await expect(
      approveApplicationUseCase({ clientRef: "non-existent-client-ref" }),
    ).rejects.toThrow(
      "Application not found for clientRef: non-existent-client-ref",
    );

    expect(findByClientRef).toHaveBeenCalledWith("non-existent-client-ref");
  });
});
