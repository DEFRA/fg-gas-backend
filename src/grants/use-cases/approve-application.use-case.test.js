import { describe, expect, it, vi } from "vitest";
import { publishApplicationApproved } from "../publishers/application-event.publisher.js";
import { approveApplicationUseCase } from "./approve-application.use-case.js";
import { findApplicationByClientRefUseCase } from "./find-application-by-client-ref.use-case.js";

vi.mock("./find-application-by-client-ref.use-case.js");
vi.mock("../publishers/application-event.publisher.js");

describe("approveApplicationUseCase", () => {
  it("publishes application approved event", async () => {
    findApplicationByClientRefUseCase.mockResolvedValue({
      clientRef: "test-client-ref",
      code: "test-grant",
      answers: { question1: "answer1" },
    });

    await approveApplicationUseCase("test-client-ref");

    expect(findApplicationByClientRefUseCase).toHaveBeenCalledWith(
      "test-client-ref",
    );

    expect(publishApplicationApproved).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "test-grant",
      answers: { question1: "answer1" },
    });
  });

  it("throws when application is not found", async () => {
    findApplicationByClientRefUseCase.mockRejectedValue(
      new Error("Application not found for clientRef: non-existent-client-ref"),
    );

    await expect(
      approveApplicationUseCase("non-existent-client-ref"),
    ).rejects.toThrow(
      "Application not found for clientRef: non-existent-client-ref",
    );

    expect(findApplicationByClientRefUseCase).toHaveBeenCalledWith(
      "non-existent-client-ref",
    );
  });
});
