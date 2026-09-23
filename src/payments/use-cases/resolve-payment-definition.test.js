import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { PaymentDefinition } from "../models/payment-definition.js";
import { loadPaymentDefinition } from "./load-payment-definition.js";
import { resolvePaymentDefinition } from "./resolve-payment-definition.js";

vi.mock("../../common/logger.js");
vi.mock("./load-payment-definition.js", () => ({
  loadPaymentDefinition: vi.fn(),
}));

const code = "gas";
const configVersion = "1.2.3";
const options = { code, configVersion };
const rawDefinition = {
  code,
  sbi: "$.agreement.sbi",
  frn: "1101234567",
  originalInvoiceNumber: "",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  ledger: "AP",
  totalAmountPence: 3800,
  currency: "GBP",
  marketingYear: "2026",
  payments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
      invoiceLines: [
        {
          schemeCode: "CMOR1",
          description: "Large White Pig",
          amountPence: 3800,
          accountCode: "SOS710",
          fundCode: "DRD10",
          deliveryBody: "RP00",
          marketingYear: "2026",
        },
      ],
    },
  ],
};

const expectResolveLogged = (error) => {
  expect(logger.error).toHaveBeenCalledWith(
    { error, event: { action: "payment-mapping-failed" } },
    `Payment mapping failed for ${code}@${configVersion}`,
  );
};

describe("resolvePaymentDefinition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exact-loads and resolves the supplied context", async () => {
    const context = { agreement: { sbi: "106284736" } };
    const values = { sbi: "106284736" };
    const resolve = vi.fn().mockResolvedValue(values);
    loadPaymentDefinition.mockResolvedValue({ resolve });

    await expect(
      resolvePaymentDefinition({ ...options, context }),
    ).resolves.toBe(values);
    expect(loadPaymentDefinition).toHaveBeenCalledWith(options);
    expect(resolve).toHaveBeenCalledWith(context);
  });

  it("resolves different contexts independently", async () => {
    loadPaymentDefinition.mockResolvedValue(
      new PaymentDefinition(rawDefinition),
    );
    const firstContext = { agreement: { sbi: "106284736" } };
    const secondContext = { agreement: { sbi: "209385847" } };

    await expect(
      resolvePaymentDefinition({ ...options, context: firstContext }),
    ).resolves.toMatchObject({ sbi: "106284736" });
    await expect(
      resolvePaymentDefinition({ ...options, context: secondContext }),
    ).resolves.toMatchObject({ sbi: "209385847" });
  });

  it("preserves an invalid aggregate resolution failure for the request", async () => {
    loadPaymentDefinition.mockResolvedValue(
      new PaymentDefinition({ ...rawDefinition, totalAmountPence: 3799 }),
    );

    const error = await resolvePaymentDefinition({
      ...options,
      context: {},
    }).catch((caught) => caught);

    expect(error).toMatchObject({ isBoom: true });
    expectResolveLogged(error);
  });

  it("does not record a load failure again", async () => {
    const error = Boom.badImplementation("Payment definition unavailable");
    loadPaymentDefinition.mockRejectedValue(error);

    await expect(
      resolvePaymentDefinition({ ...options, context: {} }),
    ).rejects.toBe(error);

    expect(logger.error).not.toHaveBeenCalled();
  });
});
