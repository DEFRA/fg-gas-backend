import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { config } from "../../common/config.js";
import { saveEvents } from "../../events/index.js";
import {
  canHandleInternalCommand,
  internalCommandTarget,
} from "../../common/internal-command-handlers.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { UpdateCaseStatusCommand } from "../commands/update-case-status.command.js";
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
import {
  auditDataBuilder,
  withdrawApplicationUseCase,
} from "./withdraw-application.use-case.js";

vi.mock("../../common/internal-command-handlers.js", async () => {
  const actual = await vi.importActual(
    "../../common/internal-command-handlers.js",
  );
  return { ...actual, canHandleInternalCommand: vi.fn() };
});
vi.mock("../repositories/application.repository.js");
vi.mock("../../events/index.js");
vi.mock("../../events/write-audit-event.js");

describe("withdrawApplicationUseCase", () => {
  let agreement;

  beforeEach(() => {
    canHandleInternalCommand.mockResolvedValue(true);
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

    expect(saveEvents).toHaveBeenCalledTimes(1);
    expect(saveEvents.mock.calls[0][0]).toHaveLength(1);
    expect(saveEvents.mock.calls[0][0][0].target).toBe(internalCommandTarget);
    expect(saveEvents.mock.calls[0][0][0].segregationRef).toBeUndefined();
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
        segregationRef: "withdraw-application-test-client-ref",
        status: "success",
      }),
      session,
    );
  });

  it.each([true, false])(
    "requests withdrawal of an accepted agreement (managed: %s)",
    async (managed) => {
      canHandleInternalCommand.mockResolvedValue(managed);
      agreement.accept({
        startDate: "2024-01-01",
        endDate: "2027-01-01",
        acceptedDate: "2024-01-02T12:00:00Z",
      });
      const application = new Application({
        currentPhase: "PHASE_PRE_AWARD",
        currentStage: "STAGE_FC_REVIEWING",
        currentStatus: "STATUS_WITHDRAWAL_REQUESTED",
        clientRef: "test-client-ref",
        code: "test-code",
        agreements: { "agreement-123": agreement },
        phases: [],
      });
      const session = {};
      findByClientRefAndCode.mockResolvedValueOnce(application);

      await withdrawApplicationUseCase(
        { clientRef: application.clientRef, code: application.code },
        session,
      );

      expect(saveEvents).toHaveBeenCalledExactlyOnceWith(
        [
          {
            event: expect.objectContaining({
              data: {
                clientRef: application.clientRef,
                code: application.code,
                status: AgreementServiceStatus.Withdrawn,
                agreementNumber: agreement.agreementRef,
              },
            }),
            target: managed
              ? internalCommandTarget
              : config.sns.updateAgreementStatusTopicArn,
          },
        ],
        session,
      );
      expect(update).not.toHaveBeenCalled();
      expect(application.getFullyQualifiedStatus()).toBe(
        "PHASE_PRE_AWARD:STAGE_FC_REVIEWING:STATUS_WITHDRAWAL_REQUESTED",
      );
      expect(agreement.latestStatus).toBe(Status.Accepted);
    },
  );

  it("routes unmanaged agreement withdrawal to the legacy topic", async () => {
    canHandleInternalCommand.mockResolvedValue(false);
    const application = new Application({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.WithdrawRequested,
      clientRef: "test-client-ref",
      code: "legacy-code",
      agreements: { "agreement-123": agreement },
      phases: [],
    });
    findByClientRefAndCode.mockResolvedValueOnce(application);

    await withdrawApplicationUseCase({
      clientRef: "test-client-ref",
      code: "legacy-code",
    });

    expect(saveEvents.mock.calls[0][0][0].target).toBe(
      config.sns.updateAgreementStatusTopicArn,
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
    expect(saveEvents).toHaveBeenCalledTimes(1);
    expect(saveEvents).toHaveBeenCalledWith(expect.any(Array), session);
    expect(saveEvents.mock.calls[0][0]).toHaveLength(2);
    expect(saveEvents.mock.calls[0][0][0]).toEqual({
      event: expect.any(UpdateCaseStatusCommand),
      target: config.sns.updateCaseStatusTopicArn,
    });
    expect(saveEvents.mock.calls[0][0][1]).toEqual(
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

  it("sets segregationRef to withdraw-application-{clientRef}", () => {
    const event = auditDataBuilder(args);

    expect(event.segregationRef).toBe("withdraw-application-test-client-ref");
  });
});
