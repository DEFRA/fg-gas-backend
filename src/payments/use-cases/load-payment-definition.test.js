import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findConfigDefinition,
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
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  ledger: "AP",
  currency: "GBP",
  marketingYear: "jsonata:$substring($.execution.executedAt, 0, 4)",
  invoiceLine: {
    schemeCode: "CMOR1",
    accountCode: "SOS710",
    fundCode: "DRD10",
  },
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

  it("loads and compiles the exact configured definition", async () => {
    const definition = await loadPaymentDefinition({
      code: "pigs-might-fly",
      configVersion: "1.2.3",
    });

    expect(findConfigDefinition).toHaveBeenCalledWith({
      grantCode: "pigs-might-fly",
      version: "1.2.3",
      definitionType: "payment",
    });
    expect(fetchConfigFile).toHaveBeenCalledWith(
      "bucket",
      "pigs-might-fly/1.2.3/gas/payment.json",
    );
    await expect(
      definition.resolve({
        execution: { executedAt: "2026-01-01T00:00:00Z" },
        agreement: {},
      }),
    ).resolves.toMatchObject({
      scheme: "SFI",
      marketingYear: "2026",
    });
    expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionType: "payment",
        fetchStatus: FetchStatus.Fetched,
      }),
    );
  });

  it("shares cached definitions", async () => {
    await loadPaymentDefinition({
      code: "pigs-might-fly",
      configVersion: "1.2.3",
    });
    await loadPaymentDefinition({
      code: "pigs-might-fly",
      configVersion: "1.2.3",
    });

    expect(fetchConfigFile).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing definition", async () => {
    findConfigDefinition.mockResolvedValue(null);

    await expect(
      loadPaymentDefinition({
        code: "pigs-might-fly",
        configVersion: "1.2.3",
      }),
    ).rejects.toThrow(
      'Payment definition "pigs-might-fly" version "1.2.3" is unavailable',
    );
  });

  it("records invalid definitions as permanent failures", async () => {
    fetchConfigFile.mockResolvedValue({ ...rawDefinition, code: "other" });

    await expect(
      loadPaymentDefinition({
        code: "pigs-might-fly",
        configVersion: "1.2.3",
      }),
    ).rejects.toThrow('code "other" does not match "pigs-might-fly"');
    expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
      expect.objectContaining({ fetchStatus: FetchStatus.PermanentError }),
    );
  });

  it("records service failures as transient", async () => {
    fetchConfigFile.mockRejectedValue(new Error("S3 unavailable"));

    await expect(
      loadPaymentDefinition({
        code: "pigs-might-fly",
        configVersion: "1.2.3",
      }),
    ).rejects.toThrow("S3 unavailable");
    expect(updateDefinitionFetchStatus).toHaveBeenCalledWith(
      expect.objectContaining({ fetchStatus: FetchStatus.TransientError }),
    );
  });
});
