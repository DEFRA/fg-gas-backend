import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import { Application } from "../models/application.js";
import { update } from "../repositories/application.repository.js";
import { updateApplicationUseCase } from "./update-application.use-case.js";

vi.mock("../repositories/application.repository.js");

describe("updateApplicationUseCase", () => {
  it("successfully updates an application", async () => {
    const application = new Application({
      clientRef: "test-client-ref",
      code: "test-grant",
      sbi: "123456789",
      frn: "987654321",
      crn: "CRN123456",
      defraId: "DEFRA123456",
      submittedAt: "2000-01-01T12:00:00Z",
      answers: {
        question1: "answer1",
        question2: "answer2",
      },
      currentStatus: "APPROVED",
    });

    const updatedApplication = new Application({
      ...application,
      currentStatus: "APPROVED",
    });

    update.mockResolvedValue(updatedApplication);

    const result = await updateApplicationUseCase(application);

    expect(update).toHaveBeenCalledWith(application);
    expect(result).toStrictEqual(updatedApplication);
  });

  it("throws Boom.badData when application is not updated", async () => {
    const application = new Application({
      clientRef: "test-client-ref",
      code: "test-grant",
      sbi: "123456789",
      frn: "987654321",
      crn: "CRN123456",
      defraId: "DEFRA123456",
      submittedAt: "2000-01-01T12:00:00Z",
      answers: {
        question1: "answer1",
      },
    });

    update.mockResolvedValue(null);

    await expect(updateApplicationUseCase(application)).rejects.toThrow(
      Boom.badData(
        `Application with clientRef ${application.clientRef} was not updated`,
      ),
    );

    expect(update).toHaveBeenCalledWith(application);
  });
});
