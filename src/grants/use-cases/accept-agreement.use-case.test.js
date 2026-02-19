import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
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
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";

vi.mock("../services/apply-event-status-change.service.js");
vi.mock("./find-application-by-client-ref-and-code.use-case.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");

describe("acceptAgreementUseCase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));

    insertMany.mockResolvedValueOnce({
      insertedId: "1",
    });

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

    findByClientRefAndCode.mockResolvedValue(
      new Application({
        currentPhase: ApplicationPhase.PreAward,
        currentStage: ApplicationStage.Assessment,
        currentStatus: ApplicationStatus.Review,
        clientRef: "test-client-ref",
        code: "test-code",
        agreements: {
          "agreement-123": agreement,
        },
      }),
    );

    applyExternalStateChange.mockResolvedValue(true);

    await acceptAgreementUseCase(
      {
        clientRef: "test-client-ref",
        code: "test-code",
        source: "AS",
        eventData: {
          date: "2024-01-01T12:00:00Z",
          agreementNumber: "agreement-123",
          startDate: "2026-01-01",
          endDate: "2027-01-01",
        },
        requestedStatus: AgreementServiceStatus.Accepted,
      },
      {},
    );
  });

  it("retrieves the application from the repository", () => {
    expect(findByClientRefAndCode).toHaveBeenCalledWith(
      { clientRef: "test-client-ref", code: "test-code" },
      {},
    );
  });

  it("updates the status of the application and marks agreement as accepted", () => {
    const appl = update.mock.calls[0][0];
    expect(appl).toBeInstanceOf(Application);
    expect(appl.agreements["agreement-123"].latestStatus).toBe("ACCEPTED");
    expect(appl.agreements["agreement-123"].startDate).toBe("2026-01-01");
    expect(appl.agreements["agreement-123"].endDate).toBe("2027-01-01");
    expect(appl.agreements["agreement-123"].acceptedDate).toBe(
      "2024-01-01T12:00:00Z",
    );
  });
});
