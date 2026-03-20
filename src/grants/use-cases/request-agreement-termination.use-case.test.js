import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementStatus as Status,
} from "../models/agreement.js";
import { Application, ApplicationStatus } from "../models/application.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { requestAgreementTerminationUseCase } from "./request-agreement-termination.use-case.js";

vi.mock("../services/apply-event-status-change.service.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");

describe("requestAgreementTerminationUseCase", () => {
  let agreement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    const mockSession = {};
    withTransaction.mockImplementation((cb) => cb(mockSession));

    agreement = new Agreement({
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
  });

  it("requests agreement termination if an agreement is found", async () => {
    const application = new Application({
      currentPhase: "POST_AGREEMENT_MONITORING",
      currentStage: "MONITORING",
      currentStatus: ApplicationStatus.TerminationRequested,
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
      currentStatus: "AGREEMENT_ACCEPTED",
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

    findByClientRefAndCode.mockResolvedValueOnce(oldApplication);
    findByClientRefAndCode.mockResolvedValueOnce(application);
    await requestAgreementTerminationUseCase(command, session);

    expect(insertMany).toHaveBeenCalledTimes(1);
    const outboxCalls = insertMany.mock.calls[0][0];
    expect(outboxCalls).toHaveLength(2);
  });

  it("creates status event even if no agreement found", async () => {
    const application = new Application({
      currentPhase: "POST_AGREEMENT_MONITORING",
      currentStage: "MONITORING",
      currentStatus: ApplicationStatus.TerminationRequested,
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: {},
      phases: [],
    });

    const oldApplication = new Application({
      currentPhase: "POST_AGREEMENT_MONITORING",
      currentStage: "MONITORING",
      currentStatus: "AGREEMENT_ACCEPTED",
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: {},
      phases: [],
    });

    const session = {};
    const command = {
      clientRef: "test-client-ref",
      code: "test-code",
      eventData: {},
    };

    findByClientRefAndCode.mockResolvedValueOnce(oldApplication);
    findByClientRefAndCode.mockResolvedValueOnce(application);
    await requestAgreementTerminationUseCase(command, session);

    expect(insertMany).toHaveBeenCalledTimes(1);
    const outboxCalls = insertMany.mock.calls[0][0];
    expect(outboxCalls).toHaveLength(1);
  });
});
