import { describe, expect, it, vi, vitest } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
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
import {
  applyAgreementTerminationUseCase,
  auditDataBuilder,
} from "./apply-agreement-termination.use-case.js";

vi.mock("../services/apply-event-status-change.service.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");
vi.mock("../../common/write-audit-event.js");

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
    writeAuditEvent.mockResolvedValue(undefined);

    await applyAgreementTerminationUseCase(command, session);

    expect(update).toHaveBeenCalledTimes(1);
    expect(agreement.latestStatus).toBe(AgreementStatus.Terminated);
    expect(insertMany).toBeCalledTimes(1);
    expect(insertMany.mock.calls[0][0]).toHaveLength(1);

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          expect.objectContaining({
            entity: auditEntities.AGREEMENT,
            action: auditActions.APPLY_AGREEMENT_TERMINATION,
            entityid: "agreement-123",
          }),
        ],
        details: {
          clientRef: "test-client-ref",
          code: "test-code",
          eventData: command.eventData,
        },
        messageGroupId: "apply-agreement-termination-agreement-123",
        status: "SUCCESS",
      }),
      session,
    );
  });
});

describe("auditDataBuilder", () => {
  const eventData = {
    agreementNumber: "agreement-123",
    date: "2024-03-01T00:00:00Z",
  };
  const args = [
    { clientRef: "test-client-ref", code: "test-code", eventData },
    {},
  ];

  it("emits APPLY_AGREEMENT_TERMINATION on the AGREEMENT entity with the correct entityid", () => {
    const event = auditDataBuilder(args);

    expect(event.entities[0]).toEqual({
      entity: auditEntities.AGREEMENT,
      action: auditActions.APPLY_AGREEMENT_TERMINATION,
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

  it("sets messageGroupId to apply-agreement-termination-{agreementNumber}", () => {
    const event = auditDataBuilder(args);

    expect(event.messageGroupId).toBe(
      "apply-agreement-termination-agreement-123",
    );
  });
});
