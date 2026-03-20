import { describe, expect, it, vi, vitest } from "vitest";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementStatus as Status,
} from "../models/agreement.js";
import { Application } from "../models/application.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { terminateAgreementUseCase } from "./terminate-agreement.use-case.js";

vi.mock("../services/apply-event-status-change.service.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");

vitest.mock("../repositories/outbox.repository.js");

describe("terminate agreement use case", () => {
  it("should terminate an agreement", async () => {
    const agreement = new Agreement({
      agreementRef: "agreement-123",
      date: "2024-01-01T12:00:00Z",
      latestStatus: Status.Accepted,
      history: [
        new AgreementHistoryEntry({
          agreementStatus: Status.Offered,
          createdAt: "2024-01-01T12:00:00Z",
        }),
        new AgreementHistoryEntry({
          agreementStatus: Status.Accepted,
          createdAt: "2024-01-02T12:00:00Z",
        }),
      ],
    });

    const application = new Application({
      currentPhase: "POST_AGREEMENT_MONITORING",
      currentStage: "MONITORING",
      currentStatus: "AGREEMENT_TERMINATED",
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: {
        "agreement-123": agreement,
      },
      phases: [],
    });

    const oldApplication = new Application({
      currentPhase: "POST_AGREEMENT_MONITORING",
      currentStage: "MONITORING",
      currentStatus: "TERMINATION_REQUESTED",
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
      eventData: {
        agreementNumber: "agreement-123",
      },
    };

    findByClientRefAndCode.mockResolvedValueOnce(application);
    findByClientRefAndCode.mockResolvedValueOnce(oldApplication);
    await terminateAgreementUseCase(command, session);

    expect(update).toHaveBeenCalledTimes(1);
    expect(agreement.latestStatus).toBe(Status.Terminated);
    expect(insertMany).toBeCalledTimes(1);
  });
});
