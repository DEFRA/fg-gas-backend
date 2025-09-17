import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementStatus,
} from "../models/agreement.js";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import { CaseStatus } from "../models/case-status.js";
import { publishApplicationStatusUpdated } from "../publishers/application-event.publisher.js";
import { publishUpdateCaseStatus } from "../publishers/case-event.publisher.js";
import { update } from "../repositories/application.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import { withdrawAgreementUseCase } from "./withdraw-agreement.use-case.js";

vi.mock("./find-application-by-client-ref-and-code.use-case.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");

describe("withdrawAgreementUseCase", () => {
  beforeEach(async () => {
    const agreement = new Agreement({
      agreementRef: "agreement-123",
      date: "2024-01-01T12:00:00Z",
      latestStatus: AgreementStatus.Offered,
      history: [
        new AgreementHistoryEntry({
          agreementStatus: AgreementStatus.Offered,
          createdAt: "2024-01-01T12:00:00Z",
        }),
      ],
    });

    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      new Application({
        currentPhase: ApplicationPhase.PreAward,
        currentStage: ApplicationStage.Assessment,
        currentStatus: ApplicationStatus.Offered,
        clientRef: "test-client-ref",
        code: "test-code",
        agreements: {
          "agreement-123": agreement,
        },
      }),
    );

    await withdrawAgreementUseCase({
      clientRef: "test-client-ref",
      code: "test-code",
      agreementRef: "agreement-123",
      date: "2024-01-01T12:00:00Z",
    });
  });

  it("retrieves the application from the repository", () => {
    expect(findApplicationByClientRefAndCodeUseCase).toHaveBeenCalledWith(
      "test-client-ref",
      "test-code",
    );
  });

  it("updates the status of the application and marks agreement as withdrawn", () => {
    expect(update).toHaveBeenCalledWith(
      new Application({
        currentPhase: ApplicationPhase.PreAward,
        currentStage: ApplicationStage.Assessment,
        currentStatus: ApplicationStatus.Withdrawn,
        clientRef: "test-client-ref",
        code: "test-code",
        updatedAt: expect.any(String),
        agreements: {
          "agreement-123": new Agreement({
            agreementRef: "agreement-123",
            date: "2024-01-01T12:00:00Z",
            updatedAt: expect.any(String),
            latestStatus: AgreementStatus.Withdrawn,
            history: [
              new AgreementHistoryEntry({
                agreementStatus: AgreementStatus.Offered,
                createdAt: "2024-01-01T12:00:00Z",
              }),
              new AgreementHistoryEntry({
                agreementStatus: AgreementStatus.Withdrawn,
                createdAt: "2024-01-01T12:00:00Z",
              }),
            ],
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
        ApplicationStatus.Offered,
      ].join(":"),
      newStatus: [
        ApplicationPhase.PreAward,
        ApplicationStage.Assessment,
        ApplicationStatus.Withdrawn,
      ].join(":"),
    });
  });

  it("publishes the case status update", () => {
    expect(publishUpdateCaseStatus).toHaveBeenCalledWith({
      caseRef: "test-client-ref",
      workflowCode: "test-code",
      newStatus: CaseStatus.OfferWithdrawn,
      data: {
        createdAt: "2024-01-01T12:00:00Z",
        agreementStatus: AgreementStatus.Withdrawn,
        agreementRef: "agreement-123",
      },
    });
  });
});
