import { describe, expect, it, vi } from "vitest";
import { Application } from "../models/application.js";
import {
  publishApplicationStatusUpdated,
  publishUpdateApplicationStatusCommand,
} from "../publishers/application-event.publisher.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { updateApplicationStatusUseCase } from "./update-application-status.use-case.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");

describe("update application status use-case", () => {
  it("should not update status if status is unknown", async () => {
    const messageData = {
      clientRef: "ABCD-0987",
      status: "foo",
      agreementNumber: "SFI123456789",
      date: "2025-01-01T00:00:00.000Z",
      correlationId: "test-correlation-id",
    };

    const application = new Application({
      clientRef: "application-1",
      code: "grant-1",
      createdAt: "2021-01-01T00:00:00.000Z",
      submittedAt: "2021-01-01T00:00:00.000Z",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        anything: "test",
      },
    });

    findByClientRefAndCode.mockResolvedValueOnce(application);

    const expectedError =
      'Can not update agreement "SFI123456789" with status "undefined" from agreementStatus "foo"';

    await expect(() =>
      updateApplicationStatusUseCase(messageData),
    ).rejects.toThrow(expectedError);
  });

  it("should update application and publish events", async () => {
    const messageData = {
      clientRef: "ABCD-0987",
      code: "grant-1",
      status: "accepted",
      agreementNumber: "SFI123456789",
      date: "2025-01-01T00:00:00.000Z",
      correlationId: "test-correlation-id",
    };

    const application = new Application({
      clientRef: "application-1",
      code: "grant-1",
      createdAt: "2021-01-01T00:00:00.000Z",
      submittedAt: "2021-01-01T00:00:00.000Z",
      identifiers: {
        sbi: "sbi-1",
        frn: "frn-1",
        crn: "crn-1",
        defraId: "defraId-1",
      },
      answers: {
        anything: "test",
      },
    });

    findByClientRefAndCode.mockResolvedValueOnce(application);

    await updateApplicationStatusUseCase(messageData);

    expect(application.status).toBe("PRE_AWARD:AWARD:OFFER_ACCEPTED");
    expect(application.currentPhase).toBe("PRE_AWARD");
    expect(application.currentStage).toBe("AWARD");
    expect(update).toBeCalledWith(application);
    expect(publishApplicationStatusUpdated).toHaveBeenCalledWith({
      clientRef: "ABCD-0987",
      oldStatus: "PENDING",
      newStatus: "OFFER_ACCEPTED",
    });
    expect(publishUpdateApplicationStatusCommand).toHaveBeenCalledWith({
      agreementData: {
        agreementRef: "SFI123456789",
        agreementStatus: "accepted",
        correlationId: "test-correlation-id",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      clientRef: "ABCD-0987",
      code: "grant-1",
      newStatus: "OFFER_ACCEPTED",
    });
  });
});
