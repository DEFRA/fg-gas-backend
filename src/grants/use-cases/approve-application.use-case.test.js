import { describe, expect, it, vi } from "vitest";
import { Application } from "../models/application.js";
import {
  publishApplicationApprovedEvent,
  publishCreateAgreementCommand,
} from "../publishers/application-event.publisher.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { approveApplicationUseCase } from "./approve-application.use-case.js";

vi.mock("../publishers/application-event.publisher.js");
vi.mock("../repositories/application.repository.js");
vi.mock("./update-application.use-case.js");

describe("approveApplicationUseCase", () => {
  it("publishes application approved event", async () => {
    const date = new Date().toISOString();
    const data = {
      clientRef: "test-client-ref",
      code: "test-grant",
      submittedAt: date,
      createdAt: date,
      identifiers: {},
      answers: { question1: "answer1" },
    };

    const mockApplication = Application.new(data);

    findByClientRefAndCode.mockResolvedValue(mockApplication);

    await approveApplicationUseCase({
      caseRef: "test-client-ref",
      workflowCode: "test-grant",
    });

    expect(findByClientRefAndCode).toHaveBeenCalledWith(
      "test-client-ref",
      "test-grant",
    );

    expect(update).toHaveBeenCalledWith(mockApplication);

    expect(publishApplicationApprovedEvent).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "test-grant",
      previousStatus: "PRE_AWARD:ASSESSMENT:RECEIVED",
      currentStatus: "PRE_AWARD:ASSESSMENT:APPROVED",
    });

    expect(publishCreateAgreementCommand).toHaveBeenCalledWith(mockApplication);
  });

  it("throws when application is not found", async () => {
    findByClientRefAndCode.mockRejectedValue(null);

    await expect(
      approveApplicationUseCase({
        caseRef: "non-existent-client-ref",
        workflowCode: "grant-1",
      }),
    ).rejects.toThrow(
      'Application with clientRef "non-existent-client-ref" and code "grant-1" not found',
    );

    expect(findByClientRefAndCode).toHaveBeenCalledWith(
      "non-existent-client-ref",
      "grant-1",
    );
  });
});
