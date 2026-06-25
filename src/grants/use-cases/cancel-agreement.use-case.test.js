import { beforeEach, describe, expect, it, vi, vitest } from "vitest";
import { writeAuditEvent } from "../../common/write-audit-event.js";
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
import { cancelAgreementUseCase } from "./cancel-agreement.use-case.js";

vi.mock("../services/apply-event-status-change.service.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");
vi.mock("../../common/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../common/write-audit-event.js", () => ({
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vitest.mock("../repositories/outbox.repository.js");

const buildApplication = () => {
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
    currentStatus: ApplicationStatus.Review,
    clientRef: "test-client-ref",
    code: "test-code",
    agreements: { "agreement-123": agreement },
    phases: [],
    replacementAllowed: false,
  });

  return { agreement, application };
};

const command = {
  clientRef: "test-client-ref",
  code: "test-code",
  source: "AS",
  eventData: {
    agreementNumber: "agreement-123",
    date: "2024-03-01T00:00:00Z",
  },
};

describe("cancel agreement use case", () => {
  beforeEach(() => {
    writeAuditEvent.mockResolvedValue(undefined);
  });

  it("should cancel an agreement", async () => {
    const { agreement, application } = buildApplication();
    const session = {};

    findByClientRefAndCode.mockResolvedValueOnce(application);

    await cancelAgreementUseCase(command, session);

    expect(update).toHaveBeenCalledTimes(1);
    expect(agreement.latestStatus).toBe(Status.Cancelled);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany.mock.calls[0][0]).toHaveLength(1);
  });

  it("writes an audit event with SUCCESS status on success", async () => {
    const { application } = buildApplication();
    const session = {};

    findByClientRefAndCode.mockResolvedValueOnce(application);

    await cancelAgreementUseCase(command, session);

    expect(writeAuditEvent).toHaveBeenCalledOnce();
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          {
            entity: "Agreement",
            action: "CANCEL_AGREEMENT",
            entityid: "test-client-ref",
          },
        ],
        details: { code: "test-code" },
        messageGroupId: "test-client-ref-test-code",
        status: "SUCCESS",
      }),
      session,
    );
  });

  it("re-throws and writes an audit event with FAILURE status when the use case fails", async () => {
    const session = {};
    findByClientRefAndCode.mockRejectedValueOnce(new Error("db error"));

    await expect(cancelAgreementUseCase(command, session)).rejects.toThrow(
      "db error",
    );

    await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalledOnce());
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILURE" }),
      session,
    );
  });
});
