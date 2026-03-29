import { describe, expect, it, vi } from "vitest";
import {
  Agreement,
  AgreementHistoryEntry,
  AgreementStatus,
} from "../models/agreement.js";
import { Application, ApplicationPhase } from "../models/application.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { applyAgreementTerminationUseCase } from "./apply-agreement-termination.use-case.js";

vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/outbox.repository.js");

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
      currentStage: "AGREEMENT_TERMINATION",
      currentStatus: "TERMINATION_REQUESTED",
      clientRef: "test-client-ref",
      code: "test-code",
      agreements: {
        "agreement-123": agreement,
      },
      phases: [],
    });

    const oldApplication = new Application({
      currentPhase: ApplicationPhase.PostAgreementMonitoring,
      currentStage: "AGREEMENT_TERMINATION",
      currentStatus: "PRE_TERMINATION_CHECKS",
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
      eventData: {
        agreementNumber: "agreement-123",
      },
    };

    findByClientRefAndCode.mockResolvedValueOnce(application);
    findByClientRefAndCode.mockResolvedValueOnce(oldApplication);
    await applyAgreementTerminationUseCase(command, session);

    expect(update).toHaveBeenCalledTimes(1);
    expect(agreement.latestStatus).toBe(AgreementStatus.Terminated);
    expect(insertMany).toHaveBeenCalledTimes(1);

    const outboxCalls = insertMany.mock.calls[0][0];
    expect(outboxCalls).toHaveLength(2);
    expect(outboxCalls[0].event.type).toContain("application.status.updated");
    expect(outboxCalls[1].event.type).toContain("case.update.status");
  });
});
