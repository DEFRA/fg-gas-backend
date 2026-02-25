import { describe, expect, it, vi } from "vitest";
import { Application } from "../models/application.js";
import { findByClientRef } from "../repositories/application.repository.js";
import { findApplicationByClientRefUseCase } from "./find-application-by-client-ref.use-case.js";

vi.mock("../repositories/application.repository.js");

describe("findApplicationByClientRefUseCase", () => {
  it("finds an application by clientRef", async () => {
    const application = new Application({
      clientRef: "test-client-ref",
      code: "test-code",
      sbi: "123456789",
      frn: "987654321",
      crn: "CRN123456",
      defraId: "DEFRA123456",
      submittedAt: "2000-01-01T12:00:00Z",
      answers: {
        question1: "answer1",
        extraField: "extra",
      },
      phases: [],
      replacementAllowed: false,
    });

    findByClientRef.mockResolvedValue(application);

    const result = await findApplicationByClientRefUseCase("test-client-ref");

    expect(findByClientRef).toHaveBeenCalledWith("test-client-ref");

    expect(result).toStrictEqual(application);
  });

  it("throws when application not found", async () => {
    findByClientRef.mockResolvedValue(null);

    await expect(
      findApplicationByClientRefUseCase("non-existent-client-ref"),
    ).rejects.toThrow(
      'Application with clientRef "non-existent-client-ref" not found',
    );
  });
});
