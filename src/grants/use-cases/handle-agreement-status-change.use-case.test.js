import { describe, expect, it, vi } from "vitest";
import { ApplicationStatus } from "../models/application.js";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";
import {
  AgreementStatus,
  handleAgreementStatusChangeUseCase,
} from "./handle-agreement-status-change.use-case.js";
import { withdrawAgreementUseCase } from "./withdraw-agreement.use-case.js";
import { withdrawApplicationUseCase } from "./withdraw-application.use-case.js";

vi.mock("./accept-agreement.use-case.js");
vi.mock("./withdraw-agreement.use-case.js");
vi.mock("./withdraw-application.use-case.js");

describe("handle agreement status chane use case", () => {
  it("marks agreement as accepted when agreement status 'accepted'", async () => {
    const mockMessage = {
      sourceSystem: "AS",
      eventData: {
        clientRef: "test-client-ref",
        code: "test-code",
        agreementNumber: "AG123",
        date: "2024-01-01T00:00:00Z",
        status: AgreementStatus.Accepted,
      },
    };

    await handleAgreementStatusChangeUseCase(mockMessage, {});

    expect(acceptAgreementUseCase).toHaveBeenCalledWith(mockMessage, {});
  });

  it("withdraws agreement from Agreement Service", async () => {
    const mockMessage = {
      sourceSystem: "AS",
      eventData: {
        clientRef: "test-client-ref",
        code: "test-code",
        agreementNumber: "AG123",
        date: "2024-01-01T00:00:00Z",
        status: AgreementStatus.Withdrawn,
      },
    };

    await handleAgreementStatusChangeUseCase(mockMessage, {});

    expect(withdrawAgreementUseCase).toHaveBeenCalledWith(mockMessage, {});
  });

  it("withdraws Application from Case Working", async () => {
    const mockMessage = {
      sourceSystem: "CW",
      eventData: {
        clientRef: "test-client-ref",
        code: "test-code",
        date: "2024-01-01T00:00:00Z",
        currentStatus: `PRE_AWARD:ASSESSMENT:${ApplicationStatus.WithdrawRequested}`,
      },
    };

    await handleAgreementStatusChangeUseCase(mockMessage, {});

    expect(withdrawApplicationUseCase).toHaveBeenCalledWith(mockMessage, {});
  });

  it("throws an error for unsupported agreement status", async () => {
    const mockMessage = {
      sourceSystem: "AS",
      eventData: {
        clientRef: "test-client-ref",
        code: "test-code",
        agreementNumber: "AG123",
        date: "2024-01-01T00:00:00Z",
        status: "invalid-status",
      },
    };

    await expect(() =>
      handleAgreementStatusChangeUseCase(mockMessage),
    ).rejects.toThrow(
      "Error: Handling accepted agreement status change for agreement AG123 with status invalid-status. Status unsupported.",
    );
  });
});
