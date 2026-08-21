import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findConfigDefinition,
  findLatestUsableDefinition,
  updateDefinitionFetchStatus,
} from "../../common/config-broker/config-catalog.repository.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { fetchConfigFile } from "../../common/s3-client.js";
import {
  clearPaymentDefinitionCaches,
  loadPaymentDefinition,
} from "./load-payment-definition.js";

vi.mock("../../common/config-broker/config-catalog.repository.js");
vi.mock("../../common/s3-client.js");
vi.mock("../../common/logger.js", () => ({
  logger: { error: vi.fn() },
}));

const rawDefinition = {
  code: "pigs-might-fly",
  sbi: "106284736",
  frn: "1101234567",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  originalInvoiceNumber: "",
  ledger: "AP",
  totalAmountPence: 3800,
  currency: "GBP",
  marketingYear: "jsonata:$substring($.execution.executedAt, 0, 4)",
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
          marketingYear: "jsonata:$substring($.execution.executedAt, 0, 4)",
        },
      ],
    },
  ],
};

const target = {
  grantCode: "pigs-might-fly",
  version: "1.2.3",
  s3Bucket: "bucket",
  s3Key: "pigs-might-fly/1.2.3/gas/payment.json",
  fetchStatus: FetchStatus.Pending,
};

describe("loadPaymentDefinition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPaymentDefinitionCaches();
    findConfigDefinition.mockResolvedValue(target);
    fetchConfigFile.mockResolvedValue(rawDefinition);
    updateDefinitionFetchStatus.mockResolvedValue({ modifiedCount: 1 });
  });

  // Fetching, caching, fetch-status latching and failure classification belong
  // to the shared Definition Loader and are covered by its own suite. What is
  // Payments' own is the definition type it asks for, what it compiles to, and
  // that it pins the exact version.
  it("compiles the payment definition for the configured version", async () => {
    const definition = await loadPaymentDefinition({
      code: "pigs-might-fly",
      configVersion: "1.2.3",
    });

    expect(findConfigDefinition).toHaveBeenCalledWith({
      grantCode: "pigs-might-fly",
      version: "1.2.3",
      definitionType: "payment",
    });
    await expect(
      definition.resolve({
        execution: { executedAt: "2026-01-01T00:00:00Z" },
        agreement: {},
      }),
    ).resolves.toMatchObject({ scheme: "SFI", marketingYear: "2026" });
  });

  it("rejects a definition published for another grant", async () => {
    fetchConfigFile.mockResolvedValue({ ...rawDefinition, code: "other" });

    await expect(
      loadPaymentDefinition({ code: "pigs-might-fly", configVersion: "1.2.3" }),
    ).rejects.toThrow('code "other" does not match "pigs-might-fly"');
  });

  // Agreements passes its own resolved config version, so the pair always
  // resolves together. See docs/MODULE_BOUNDARIES.md.
  it("never falls back to an older version", async () => {
    findConfigDefinition.mockResolvedValue(null);

    await expect(
      loadPaymentDefinition({ code: "pigs-might-fly", configVersion: "1.2.3" }),
    ).rejects.toThrow(
      'Payment definition "pigs-might-fly" version "1.2.3" is unavailable',
    );
    expect(findLatestUsableDefinition).not.toHaveBeenCalled();
  });
});
