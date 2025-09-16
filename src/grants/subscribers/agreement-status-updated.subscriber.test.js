import { describe, expect, it, vi } from "vitest";
import { acceptAgreementUseCase } from "../use-cases/accept-agreement.use-case.js";
import { addAgreementUseCase } from "../use-cases/add-agreement.use-case.js";
import { withdrawAgreementUseCase } from "../use-cases/withdraw-agreement.use-case.js";
import {
  AgreementStatus,
  agreementStatusUpdatedSubscriber,
} from "./agreement-status-updated.subscriber.js";

vi.mock("../use-cases/add-agreement.use-case.js");
vi.mock("../use-cases/accept-agreement.use-case.js");
vi.mock("../use-cases/withdraw-agreement.use-case.js");

describe("agreementStatusUpdatedSubscriber", () => {
  it("adds agreement to application when agreement status 'offered'", async () => {
    const mockMessage = {
      data: {
        clientRef: "test-client-ref",
        code: "test-code",
        agreementNumber: "AG123",
        date: "2024-01-01T00:00:00Z",
        status: AgreementStatus.Offered,
      },
    };

    await agreementStatusUpdatedSubscriber.onMessage(mockMessage);

    expect(addAgreementUseCase).toHaveBeenCalledWith({
      agreementRef: "AG123",
      clientRef: "test-client-ref",
      code: "test-code",
      date: "2024-01-01T00:00:00Z",
    });
  });

  it("marks agreement as accepted when agreement status 'accepted'", async () => {
    const mockMessage = {
      data: {
        clientRef: "test-client-ref",
        code: "test-code",
        agreementNumber: "AG123",
        date: "2024-01-01T00:00:00Z",
        status: AgreementStatus.Accepted,
      },
    };

    await agreementStatusUpdatedSubscriber.onMessage(mockMessage);

    expect(acceptAgreementUseCase).toHaveBeenCalledWith({
      agreementRef: "AG123",
      clientRef: "test-client-ref",
      code: "test-code",
      date: "2024-01-01T00:00:00Z",
    });
  });

  it("marks agreement as withdrawn when agreement status 'withdrawn'", async () => {
    const mockMessage = {
      data: {
        clientRef: "test-client-ref",
        code: "test-code",
        agreementNumber: "AG123",
        date: "2024-01-01T00:00:00Z",
        status: AgreementStatus.Withdrawn,
      },
    };

    await agreementStatusUpdatedSubscriber.onMessage(mockMessage);

    expect(withdrawAgreementUseCase).toHaveBeenCalledWith({
      agreementRef: "AG123",
      clientRef: "test-client-ref",
      code: "test-code",
      date: "2024-01-01T00:00:00Z",
    });
  });

  it("throws an error for unsupported agreement status", async () => {
    const mockMessage = {
      data: {
        clientRef: "test-client-ref",
        code: "test-code",
        agreementNumber: "AG123",
        date: "2024-01-01T00:00:00Z",
        status: "invalid-status",
      },
    };

    await expect(
      agreementStatusUpdatedSubscriber.onMessage(mockMessage),
    ).rejects.toThrow('Unsupported agreement status "invalid-status"');
  });
});
