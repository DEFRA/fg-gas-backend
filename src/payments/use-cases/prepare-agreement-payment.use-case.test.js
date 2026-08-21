import { describe, expect, it, vi } from "vitest";
import { loadPaymentDefinition } from "./load-payment-definition.js";
import { prepareAgreementPayment } from "./prepare-agreement-payment.use-case.js";

vi.mock("./load-payment-definition.js");

const paymentConfiguration = { scheme: "SFI" };

describe("prepareAgreementPayment", () => {
  it("prepares a Payment operation using the configured version and Agreement context", async () => {
    const resolve = vi.fn().mockResolvedValue(paymentConfiguration);
    loadPaymentDefinition.mockResolvedValue({ resolve });
    const agreement = { agreementNumber: "PMF123", code: "pigs-might-fly" };
    const execution = { executedAt: "2026-08-30T10:00:00.000Z" };

    await expect(
      prepareAgreementPayment({
        code: "pigs-might-fly",
        configVersion: "1.2.0",
        agreement,
        execution,
      }),
    ).resolves.toEqual({
      commitOperations: [
        {
          type: "create-agreement-payment",
          request: { paymentConfiguration },
        },
      ],
    });
    expect(loadPaymentDefinition).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: "1.2.0",
    });
    expect(resolve).toHaveBeenCalledWith({ agreement, execution });
  });
});
