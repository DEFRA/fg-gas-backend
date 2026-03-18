import { describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementServiceStatus,
  AgreementStatus,
} from "../models/agreement.js";
import { Application } from "../models/application.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { requestAgreementCancellationUseCase } from "./request-agreement-cancellation.use-case.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/outbox.repository.js");

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
              status: AgreementServiceStatus.Cancel,
              agreementNumber: "agreement-123",
            }),
          }),
          target: config.sns.updateAgreementStatusTopicArn,
        }),
      ],
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
  });
});
