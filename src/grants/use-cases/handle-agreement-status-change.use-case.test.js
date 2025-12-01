import { describe, expect, it, vi } from "vitest";
import { acceptAgreementUseCase } from "./accept-agreement.use-case.js";
import {
  AgreementStatus,
  handleAgreementStatusChangeUseCase,
} from "./handle-agreement-status-change.use-case.js";

vi.mock("../use-cases/accept-agreement.use-case.js");
vi.mock("../use-cases/withdraw-agreement.use-case.js");

describe("agreementStatusUpdatedSubscriber", () => {
  it("marks agreement as accepted when agreement status 'accepted'", async () => {
    const mockMessage = {
      source: "AS",
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

  it("throws an error for unsupported agreement status", async () => {
    const mockMessage = {
      source: "AS",
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
