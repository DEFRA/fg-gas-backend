import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { AgreementStatus } from "../models/agreement.js";
import {
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import { CaseStatus } from "../models/case-status.js";
import { publishApplicationStatusUpdated } from "../publishers/application-event.publisher.js";
import { publishUpdateCaseStatus } from "../publishers/case-event.publisher.js";
import { update } from "../repositories/application.repository.js";
import { addAgreementUseCase } from "./add-agreement.use-case.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

vi.mock("./find-application-by-client-ref-and-code.use-case.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");

describe("addAgreementUseCase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      createTestApplication({
        clientRef: "test-client-ref",
        code: "test-code",
      }),
    );

    await addAgreementUseCase({
      clientRef: "test-client-ref",
      code: "test-code",
      agreementRef: "agreement-123",
      date: "2024-01-01T12:00:00Z",
    });
  });

  it("uses the repository to retrieve the application", () => {
    expect(findApplicationByClientRefAndCodeUseCase).toHaveBeenCalledWith(
      "test-client-ref",
      "test-code",
    );
  });

  it("updates the application with the new agreement", () => {
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPhase: ApplicationPhase.PreAward,
        currentStage: ApplicationStage.Award,
        currentStatus: ApplicationStatus.Review,
        agreements: {
          "agreement-123": expect.objectContaining({
            agreementRef: "agreement-123",
            latestStatus: AgreementStatus.Offered,
          }),
        },
      }),
    );
  });

  it("publishes the ApplicationStatusUpdated", () => {
    expect(publishApplicationStatusUpdated).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      oldStatus: [
        ApplicationPhase.PreAward,
        ApplicationStage.Assessment,
        ApplicationStatus.Received,
      ].join(":"),
      newStatus: [
        ApplicationPhase.PreAward,
        ApplicationStage.Award,
        ApplicationStatus.Review,
      ].join(":"),
    });
  });

  it("publishes the case status update", () => {
    expect(publishUpdateCaseStatus).toHaveBeenCalledWith({
      caseRef: "test-client-ref",
      workflowCode: "test-code",
      newStatus: CaseStatus.Review,
      targetNode: "agreements",
      data: [
        {
          createdAt: "2024-01-01T12:00:00Z",
          updatedAt: "2024-01-15T10:30:00.000Z",
          agreementStatus: AgreementStatus.Offered,
          agreementRef: "agreement-123",
        },
      ],
    });
  });
});
