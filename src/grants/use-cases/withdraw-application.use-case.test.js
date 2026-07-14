import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
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
import {
  auditDataBuilder,
  withdrawApplicationUseCase,
} from "./withdraw-application.use-case.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../repositories/outbox.repository.js");
vi.mock("../../common/write-audit-event.js");

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

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          expect.objectContaining({
            entity: auditEntities.APPLICATION,
            action: auditActions.WITHDRAW_APPLICATION,
            entityid: "test-client-ref",
          }),
        ],
        details: {
          clientRef: "test-client-ref",
          code: "test-code",
        },
        messageGroupId: "withdraw-application-test-client-ref",
        status: "SUCCESS",
      }),
      session,
    );
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

describe("auditDataBuilder", () => {
  const args = [{ clientRef: "test-client-ref", code: "test-code" }, {}];

  it("emits WITHDRAW_APPLICATION on the APPLICATION entity with the clientRef as entityid", () => {
    const event = auditDataBuilder(args);

    expect(event.entities[0]).toEqual({
      entity: auditEntities.APPLICATION,
      action: auditActions.WITHDRAW_APPLICATION,
      entityid: "test-client-ref",
    });
  });

  it("includes clientRef and code in details", () => {
    const event = auditDataBuilder(args);

    expect(event.details).toEqual({
      clientRef: "test-client-ref",
      code: "test-code",
    });
  });

  it("sets messageGroupId to withdraw-application-{clientRef}", () => {
    const event = auditDataBuilder(args);

    expect(event.messageGroupId).toBe("withdraw-application-test-client-ref");
  });
});
