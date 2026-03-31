import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementServiceStatus,
  AgreementStatus,
} from "../models/agreement.js";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { requestAgreementTerminationUseCase } from "./request-agreement-termination.use-case.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/outbox.repository.js");

describe("requestAgreementTerminationUseCase", () => {
  let agreement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    agreement = new Agreement({
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
  });

  it("sends termination request to Agreement Service when agreement exists", async () => {
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
    };

    findByClientRefAndCode.mockResolvedValueOnce(application);
    await requestAgreementTerminationUseCase(command, session);

    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          target: config.sns.updateAgreementStatusTopicArn,
        }),
      ],
      session,
    );

    const outboxCall = insertMany.mock.calls[0][0][0];
    expect(outboxCall.event.data.status).toBe(
      AgreementServiceStatus.Terminated,
    );
    expect(outboxCall.event.data.agreementNumber).toBe("agreement-123");
  });

  it("does not send request when no agreement exists", async () => {
    const application = new Application({
      currentPhase: ApplicationPhase.PostAgreementMonitoring,
      currentStage: ApplicationStage.Monitoring,
      currentStatus: ApplicationStatus.AgreementAccepted,
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: {},
      phases: [],
    });

    const session = {};
    const command = {
      clientRef: "test-client-ref",
      code: "test-code",
    };

    findByClientRefAndCode.mockResolvedValueOnce(application);
    await requestAgreementTerminationUseCase(command, session);

    expect(insertMany).not.toHaveBeenCalled();
  });
});
