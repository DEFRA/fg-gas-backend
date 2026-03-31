import { describe, expect, it, vi, vitest } from "vitest";
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
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { applyAgreementTerminationUseCase } from "./apply-agreement-termination.use-case.js";

vi.mock("../services/apply-event-status-change.service.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");

vitest.mock("../repositories/outbox.repository.js");

describe("applyAgreementTerminationUseCase", () => {
  it("should terminate an agreement and notify CW", async () => {
    const agreement = new Agreement({
      agreementRef: "agreement-123",
      date: "2024-01-01T12:00:00Z",
      latestStatus: AgreementStatus.Accepted,
      history: [
        new AgreementHistoryEntry({
          agreementStatus: AgreementStatus.Offered,
          createdAt: "2024-01-01T12:00:00Z",
        }),
        new AgreementHistoryEntry({
          agreementStatus: AgreementStatus.Accepted,
          createdAt: "2024-01-02T12:00:00Z",
        }),
      ],
    });

    const application = new Application({
      currentPhase: ApplicationPhase.PostAgreementMonitoring,
      currentStage: ApplicationStage.Monitoring,
      currentStatus: ApplicationStatus.AgreementAccepted,
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: {
        "agreement-123": agreement,
      },
      phases: [],
    });

    const session = {};
    const command = {
      clientRef: "test-client-ref",
      code: "test-code",
      source: "AS",
      eventData: {
        agreementNumber: "agreement-123",
        date: "2024-03-01T00:00:00Z",
      },
    };

    findByClientRefAndCode.mockResolvedValueOnce(application);

    await applyAgreementTerminationUseCase(command, session);

    expect(update).toHaveBeenCalledTimes(1);
    expect(agreement.latestStatus).toBe(AgreementStatus.Terminated);
    expect(insertMany).toBeCalledTimes(1);
    expect(insertMany.mock.calls[0][0]).toHaveLength(1);
  });
});
