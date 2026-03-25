import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementServiceStatus,
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
import { withdrawApplicationUseCase } from "./withdraw-application.use-case.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../repositories/outbox.repository.js");

describe("withdrawApplicationUseCase", () => {
  let agreement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    agreement = new Agreement({
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
  });

  it("requests agreement withdrawal if an agreement is found", async () => {
    const application = new Application({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.WithdrawRequested,
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
      agreementRef: "agreement-123",
      date: "2024-01-01T12:00:00Z",
      requestedStatus: AgreementServiceStatus.Withdrawn,
      source: "AS",
      eventData: {
        agreementRef: "agreement-123",
      },
    };

    findByClientRefAndCode.mockResolvedValueOnce(application);
    await withdrawApplicationUseCase(command, session);

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany.mock.calls[0][0]).toHaveLength(1);
    expect(agreement.latestStatus).toBe(Status.Offered);
  });

  it("withdraws an application and publishes the final status transition", async () => {
    const application = new Application({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.WithdrawRequested,
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: {},
      phases: [],
    });
    const session = {};
    const command = {
      clientRef: "test-client-ref",
      code: "test-code",
      agreementRef: "agreement-123",
      date: "2024-01-01T12:00:00Z",
      requestedStatus: AgreementServiceStatus.Withdrawn,
      source: "AS",
      eventData: {},
    };

    findByClientRefAndCode.mockResolvedValueOnce(application);
    await withdrawApplicationUseCase(command, session);

    expect(update).toHaveBeenCalledTimes(1);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany.mock.calls[0][0]).toHaveLength(2);
    expect(insertMany.mock.calls[0][0][1]).toEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          data: expect.objectContaining({
            previousStatus: "PRE_AWARD:ASSESSMENT:WITHDRAWAL_REQUESTED",
            currentStatus: "PRE_AWARD:ASSESSMENT:APPLICATION_WITHDRAWN",
          }),
        }),
      }),
    );
    expect(application.getFullyQualifiedStatus().toString()).toBe(
      "PRE_AWARD:ASSESSMENT:APPLICATION_WITHDRAWN",
    );
  });
});
