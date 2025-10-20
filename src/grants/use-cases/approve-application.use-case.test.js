import { describe, expect, it, vi } from "vitest";
import { Application, ApplicationStatus } from "../models/application.js";
import {
  publishApplicationStatusUpdated,
  publishCreateAgreementCommand,
} from "../publishers/application-event.publisher.js";
import { update } from "../repositories/application.repository.js";
import { approveApplicationUseCase } from "./approve-application.use-case.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

vi.mock("./find-application-by-client-ref-and-code.use-case.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../repositories/application.repository.js");

describe("approveApplicationUseCase", () => {
  it("finds an existing application", async () => {
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      new Application({}),
    );

    await approveApplicationUseCase({
      clientRef: "test-client-ref",
      code: "test-grant",
    });

    expect(findApplicationByClientRefAndCodeUseCase).toHaveBeenCalledWith(
      "test-client-ref",
      "test-grant",
    );
  });

  it("approves and updates the application", async () => {
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      new Application({
        currentStatus: ApplicationStatus.Received,
      }),
    );

    await approveApplicationUseCase({
      clientRef: "test-client-ref",
      code: "test-grant",
    });

    expect(update).toHaveBeenCalledWith(
      new Application({
        currentStatus: ApplicationStatus.Approved,
        updatedAt: expect.any(String),
      }),
    );
  });

  it("publishes ApplicationStatusUpdatedEvent", async () => {
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      new Application({
        clientRef: "test-client-ref",
        code: "test-grant",
        currentPhase: ApplicationStatus.PreAward,
        currentStage: ApplicationStatus.Assessment,
        currentStatus: ApplicationStatus.Received,
      }),
    );

    await approveApplicationUseCase({
      clientRef: "test-client-ref",
      code: "test-grant",
    });

    expect(publishApplicationStatusUpdated).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "test-grant",
      previousStatus: `${ApplicationStatus.PreAward}:${ApplicationStatus.Assessment}:${ApplicationStatus.Received}`,
      currentStatus: `${ApplicationStatus.PreAward}:${ApplicationStatus.Assessment}:${ApplicationStatus.Approved}`,
    });
  });

  it("publishes CreateAgreementCommand", async () => {
    const application = new Application({
      clientRef: "test-client-ref",
      code: "test-grant",
    });

    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(application);

    await approveApplicationUseCase({
      clientRef: "test-client-ref",
      code: "test-grant",
    });

    expect(publishCreateAgreementCommand).toHaveBeenCalledWith(application);
  });

  it("does nothing when application has already been approved", async () => {
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      new Application({
        clientRef: "test-client-ref",
        code: "test-grant",
        currentStatus: ApplicationStatus.Approved,
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
    );

    await expect(() =>
      approveApplicationUseCase({
        clientRef: "test-client-ref",
        code: "test-grant",
      }),
    ).rejects.toThrowError(
      'Application with clientRef "test-client-ref" and code "test-grant" is already approved',
    );

    expect(update).not.toHaveBeenCalled();
    expect(publishApplicationStatusUpdated).not.toHaveBeenCalled();
    expect(publishCreateAgreementCommand).not.toHaveBeenCalled();
  });
});
