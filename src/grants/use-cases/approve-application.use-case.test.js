import { describe, expect, it, vi } from "vitest";
import {
  publishApplicationApproved,
  publishGenerateAgreement,
} from "../publishers/application-event.publisher.js";
import { approveApplicationUseCase } from "./approve-application.use-case.js";
import { findApplicationByClientRefUseCase } from "./find-application-by-client-ref.use-case.js";
import { updateApplicationUseCase } from "./update-application.use-case.js";

vi.mock("./find-application-by-client-ref.use-case.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("./update-application.use-case.js");

describe("approveApplicationUseCase", () => {
  it("publishes application approved event", async () => {
    findApplicationByClientRefUseCase.mockResolvedValue({
      clientRef: "test-client-ref",
      code: "test-grant",
      answers: { question1: "answer1" },
      currentPhase: "phase1",
      currentStage: "stage1",
    });

    await approveApplicationUseCase({ clientRef: "test-client-ref" });

    expect(findApplicationByClientRefUseCase).toHaveBeenCalledWith(
      "test-client-ref",
    );

    expect(updateApplicationUseCase).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "test-grant",
      answers: { question1: "answer1" },
      currentPhase: "phase1",
      currentStage: "stage1",
      currentStatus: "APPROVED",
    });

    expect(publishApplicationApproved).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      previousStatus: "phase1:stage1:RECEIVED",
      currentStatus: "phase1:stage1:APPROVED",
    });

    expect(publishGenerateAgreement).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "test-grant",
      answers: { question1: "answer1" },
      currentPhase: "phase1",
      currentStage: "stage1",
      currentStatus: "APPROVED",
    });
  });

  it("throws when application is not found", async () => {
    findApplicationByClientRefUseCase.mockRejectedValue(
      new Error("Application not found for clientRef: non-existent-client-ref"),
    );

    await expect(
      approveApplicationUseCase({ clientRef: "non-existent-client-ref" }),
    ).rejects.toThrow(
      "Application not found for clientRef: non-existent-client-ref",
    );

    expect(findApplicationByClientRefUseCase).toHaveBeenCalledWith(
      "non-existent-client-ref",
    );
  });
});
