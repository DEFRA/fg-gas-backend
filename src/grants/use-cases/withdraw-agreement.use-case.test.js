import { describe, expect, it, vi, vitest } from "vitest";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementStatus as Status,
} from "../models/agreement.js";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { withdrawAgreementUseCase } from "./withdraw-agreement.use-case.js";

vi.mock("../services/apply-event-status-change.service.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");

vitest.mock("../repositories/outbox.repository.js");

describe("withdraw agreement use case", () => {
  it("should withdraw an agreement", async () => {
    const agreement = new Agreement({
      agreementRef: "agreement-123",
      date: "2024-01-01T12:00:00Z",
      latestStatus: Status.Offered,
      history: [
        new AgreementHistoryEntry({
          agreementStatus: Status.Offered,
          createdAt: "2024-01-01T12:00:00Z",
        }),
      ],
    });

    const application = new Application({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.Withdrawn,
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: {
        "agreement-123": agreement,
      },
    });

    const oldApplication = new Application({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.WithdrawRequested,
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: {
        "agreement-123": agreement,
      },
    });

    const session = {};
    const command = {
      clientRef: "test-client-ref",
      code: "test-code",
      agreementRef: "agreement-123",
      date: "2024-01-01T12:00:00Z",
      requestedStatus: Status.Withdrawn,
      source: "AS",
      eventData: {
        agreementNumber: "agreement-123",
      },
    };

    findByClientRefAndCode.mockResolvedValueOnce(application);
    findByClientRefAndCode.mockResolvedValueOnce(oldApplication);
    await withdrawAgreementUseCase(command, session);

    expect(update).toHaveBeenCalledTimes(1);
    expect(agreement.latestStatus).toBe(Status.Withdrawn);
    expect(insertMany).toBeCalledTimes(1);
  });
});
