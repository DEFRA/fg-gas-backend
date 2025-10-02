import { describe, expect, it, vi } from "vitest";
import { Application } from "../models/application.ts";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

vi.mock("../repositories/application.repository.js");

describe("findApplicationByClientRefAndCodeUseCase", () => {
  it("finds an application by clientRef", async () => {
    const application = new Application({
      clientRef: "test-client-ref",
      sbi: "123456789",
      frn: "987654321",
      crn: "CRN123456",
      defraId: "DEFRA123456",
      submittedAt: "2000-01-01T12:00:00Z",
      answers: {
        question1: "answer1",
        extraField: "extra",
      },
    });

    findByClientRefAndCode.mockResolvedValue(application);

    const result = await findApplicationByClientRefAndCodeUseCase(
      "test-client-ref",
      "any-code",
    );

    expect(findByClientRefAndCode).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "any-code",
    });

    expect(result).toStrictEqual(application);
  });

  it("throws when application not found", async () => {
    findByClientRefAndCode.mockResolvedValue(null);

    await expect(
      findApplicationByClientRefAndCodeUseCase(
        "non-existent-client-ref",
        "any-code",
      ),
    ).rejects.toThrow(
      'Application with clientRef "non-existent-client-ref" and code "any-code" not found',
    );
  });
});
