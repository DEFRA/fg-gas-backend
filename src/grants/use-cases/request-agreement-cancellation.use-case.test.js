import { describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { config } from "../../common/config.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementServiceStatus,
  AgreementStatus,
} from "../models/agreement.js";
import { Application } from "../models/application.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import {
  auditDataBuilder,
  requestAgreementCancellationUseCase,
} from "./request-agreement-cancellation.use-case.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/outbox.repository.js");
vi.mock("../../common/write-audit-event.js");

describe("requestAgreementCancellationUseCase", () => {
  it("publishes an agreement cancellation command when an offered agreement exists", async () => {
    const agreement = new Agreement({
      agreementRef: "agreement-123",
      latestStatus: AgreementStatus.Offered,
      updatedAt: "2024-01-01T12:00:00Z",
      history: [
        new AgreementHistoryEntry({
          agreementStatus: AgreementStatus.Offered,
          createdAt: "2024-01-01T12:00:00Z",
        }),
      ],
    });

    const application = new Application({
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_OFFER",
      currentStatus: "AMENDMENT_REQUESTED",
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: { "agreement-123": agreement },
      phases: [],
      replacementAllowed: false,
    });

    findByClientRefAndCode.mockResolvedValue(application);

    await requestAgreementCancellationUseCase(
      {
        clientRef: "test-client-ref",
        code: "test-code",
      },
      {},
    );

    expect(insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          event: expect.objectContaining({
            data: expect.objectContaining({
              clientRef: "test-client-ref",
              code: "test-code",
              status: AgreementServiceStatus.Cancelled,
              agreementNumber: "agreement-123",
            }),
          }),
          target: config.sns.updateAgreementStatusTopicArn,
        }),
      ],
      {},
    );

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          expect.objectContaining({
            entity: auditEntities.AGREEMENT,
            action: auditActions.REQUEST_AGREEMENT_CANCELLATION,
            entityid: "agreement-123",
          }),
        ],
        details: {
          clientRef: "test-client-ref",
          code: "test-code",
          agreementNumber: "agreement-123",
        },
        messageGroupId: "request-agreement-cancellation-agreement-123",
        status: "SUCCESS",
      }),
      {},
    );
  });

  it("does nothing when there is no active agreement", async () => {
    const application = new Application({
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_OFFER",
      currentStatus: "AMENDMENT_REQUESTED",
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: {},
      phases: [],
      replacementAllowed: false,
    });

    findByClientRefAndCode.mockResolvedValue(application);

    await requestAgreementCancellationUseCase(
      {
        clientRef: "test-client-ref",
        code: "test-code",
      },
      {},
    );

    expect(insertMany).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });
});

describe("auditDataBuilder", () => {
  const args = [{ clientRef: "test-client-ref", code: "test-code" }, {}];

  it("emits REQUEST_AGREEMENT_CANCELLATION on the AGREEMENT entity with the agreementNumber as entityid", () => {
    const event = auditDataBuilder(args, { agreementNumber: "agreement-123" });

    expect(event.entities[0]).toEqual({
      entity: auditEntities.AGREEMENT,
      action: auditActions.REQUEST_AGREEMENT_CANCELLATION,
      entityid: "agreement-123",
    });
  });

  it("returns null when no agreement was cancelled so no audit is written", () => {
    expect(auditDataBuilder(args, undefined)).toBeNull();
  });

  it("includes clientRef, code and agreementNumber in details", () => {
    const event = auditDataBuilder(args, { agreementNumber: "agreement-123" });

    expect(event.details).toEqual({
      clientRef: "test-client-ref",
      code: "test-code",
      agreementNumber: "agreement-123",
    });
  });

  it("sets messageGroupId to request-agreement-cancellation-{agreementNumber}", () => {
    const event = auditDataBuilder(args, { agreementNumber: "agreement-123" });

    expect(event.messageGroupId).toBe(
      "request-agreement-cancellation-agreement-123",
    );
  });
});
