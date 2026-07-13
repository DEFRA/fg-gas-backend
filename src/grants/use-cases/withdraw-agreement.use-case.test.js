import { describe, expect, it, vi, vitest } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
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
import {
  auditDataBuilder,
  withdrawAgreementUseCase,
} from "./withdraw-agreement.use-case.js";

vi.mock("../services/apply-event-status-change.service.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");
vi.mock("../../common/write-audit-event.js");

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
      phases: [],
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
    writeAuditEvent.mockResolvedValue(undefined);

    await withdrawAgreementUseCase(command, session);

    expect(update).toHaveBeenCalledTimes(1);
    expect(agreement.latestStatus).toBe(Status.Withdrawn);
    expect(insertMany).toBeCalledTimes(1);
    expect(insertMany.mock.calls[0][0]).toHaveLength(1);

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          expect.objectContaining({
            entity: auditEntities.AGREEMENT,
            action: auditActions.WITHDRAW_AGREEMENT,
            entityid: "agreement-123",
          }),
        ],
        details: {
          clientRef: "test-client-ref",
          code: "test-code",
          eventData: command.eventData,
        },
        messageGroupId: "withdraw-agreement-agreement-123",
        status: "SUCCESS",
      }),
      session,
    );
  });
});

describe("auditDataBuilder", () => {
  const eventData = {
    agreementNumber: "agreement-123",
  };
  const args = [
    { clientRef: "test-client-ref", code: "test-code", eventData },
    {},
  ];

  it("emits WITHDRAW_AGREEMENT on the AGREEMENT entity with the correct entityid", () => {
    const event = auditDataBuilder(args);

    expect(event.entities[0]).toEqual({
      entity: auditEntities.AGREEMENT,
      action: auditActions.WITHDRAW_AGREEMENT,
      entityid: "agreement-123",
    });
  });

  it("includes clientRef, code and eventData in details", () => {
    const event = auditDataBuilder(args);

    expect(event.details).toEqual({
      clientRef: "test-client-ref",
      code: "test-code",
      eventData,
    });
  });

  it("sets messageGroupId to withdraw-agreement-{agreementNumber}", () => {
    const event = auditDataBuilder(args);

    expect(event.messageGroupId).toBe("withdraw-agreement-agreement-123");
  });
});
