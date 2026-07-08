import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
import { Agreement } from "../models/agreement.js";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import { Outbox } from "../models/outbox.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import {
  addAgreementUseCase,
  auditDataBuilder,
} from "./add-agreement.use-case.js";

vi.mock("../commands/update-case-status.command.js");
vi.mock("../services/apply-event-status-change.service.js");
vi.mock("./find-application-by-client-ref-and-code.use-case.js");
vi.mock("../models/outbox.js");
vi.mock("../repositories/outbox.repository.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/outbox.repository.js");
vi.mock("../../common/write-audit-event.js");

describe("addAgreementUseCase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    const mockSession = {};

    const testApplication = createTestApplication({
      clientRef: "test-client-ref",
      code: "test-code",
    });

    findByClientRefAndCode.mockResolvedValue(testApplication);

    insertMany.mockResolvedValue(true);
    writeAuditEvent.mockResolvedValue(undefined);

    await addAgreementUseCase(
      {
        clientRef: "test-client-ref",
        code: "test-code",
        currentStatus: ApplicationStatus.Review,
        currentPhase: ApplicationPhase.PreAward,
        currentStage: ApplicationStage.Assessment,
        eventData: {
          agreementNumber: "agreement-123",
          date: "2024-01-01T12:00:00Z",
        },
      },
      mockSession,
    );
  });

  it("updates the application with the new agreement", () => {
    const application = update.mock.calls[0][0];
    expect(application).toBeInstanceOf(Application);
    expect(application.agreements["agreement-123"]).toBeInstanceOf(Agreement);
    expect(insertMany).toHaveBeenCalledWith([expect.any(Outbox)], {});
    expect(UpdateCaseStatusCommand).toHaveBeenCalledWith({
      caseRef: "test-client-ref",
      workflowCode: "test-code",
      newStatus: "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED",
      phase: "PRE_AWARD",
      stage: "ASSESSMENT",
      dataType: "ARRAY",
      key: "agreementRef",
      targetNode: "agreements",
      data: {
        agreementRef: "agreement-123",
        agreementStatus: "OFFERED",
        createdAt: "2024-01-01T12:00:00Z",
        updatedAt: "2024-01-15T10:30:00.000Z",
      },
    });
  });

  it("writes an audit event for the added agreement", () => {
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          expect.objectContaining({
            entity: auditEntities.AGREEMENT,
            action: auditActions.ADD_AGREEMENT,
            entityid: "agreement-123",
          }),
        ],
        details: {
          clientRef: "test-client-ref",
          code: "test-code",
          agreementDate: "2024-01-01T12:00:00Z",
        },
        messageGroupId: "add-agreement-agreement-123",
        status: "SUCCESS",
      }),
      {},
    );
  });
});

describe("auditDataBuilder", () => {
  const eventData = {
    agreementNumber: "agreement-123",
    date: "2024-01-01T12:00:00Z",
  };
  const args = [
    { clientRef: "test-client-ref", code: "test-code", eventData },
    {},
  ];

  it("emits ADD_AGREEMENT on the AGREEMENT entity with the correct entityid", () => {
    const event = auditDataBuilder(args);

    expect(event.entities[0]).toEqual({
      entity: auditEntities.AGREEMENT,
      action: auditActions.ADD_AGREEMENT,
      entityid: "agreement-123",
    });
  });

  it("includes clientRef, code and agreementDate in details", () => {
    const event = auditDataBuilder(args);

    expect(event.details).toEqual({
      clientRef: "test-client-ref",
      code: "test-code",
      agreementDate: "2024-01-01T12:00:00Z",
    });
  });

  it("sets messageGroupId to add-agreement-{agreementNumber}", () => {
    const event = auditDataBuilder(args);

    expect(event.messageGroupId).toBe("add-agreement-agreement-123");
  });
});
