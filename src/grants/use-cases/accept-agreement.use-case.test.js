import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
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
import { update } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import { AgreementStatus } from "./handle-agreement-status-change.use-case.js";

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

    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
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

    await acceptAgreementUseCase({
      clientRef: "test-client-ref",
      code: "test-code",
      agreementRef: "agreement-123",
      date: "2024-01-01T12:00:00Z",
      source: "AS",
      requestedStatus: AgreementStatus.Accepted,
    });
  });

  it("retrieves the application from the repository", () => {
    expect(findApplicationByClientRefAndCodeUseCase).toHaveBeenCalledWith(
      "test-client-ref",
      "test-code",
    );
  });

  it("updates the status of the application and marks agreement as accepted", () => {
    const appl = update.mock.calls[0][0];
    expect(appl).toBeInstanceOf(Application);
    expect(applyExternalStateChange).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "test-code",
      externalRequestedState: "accepted",
      sourceSystem: "AS",
    });
  });
});
