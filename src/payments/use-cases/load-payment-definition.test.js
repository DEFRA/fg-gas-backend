import { MongoServerError } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findConfigDefinition,
  updateDefinitionFetchStatus,
} from "../../common/config-broker/config-catalog.repository.js";
import { FetchStatus } from "../../common/fetch-status.js";
import { logger } from "../../common/logger.js";
import { fetchConfigFile, S3FetchError } from "../../common/s3-client.js";
import { PaymentDefinition } from "../models/payment-definition.js";
import {
  findPaymentDefinition,
  insertPaymentDefinition,
} from "../repositories/payment-definition.repository.js";
import {
  clearPaymentDefinitionCaches,
  loadPaymentDefinition,
} from "./load-payment-definition.js";

vi.mock("../../common/config-broker/config-catalog.repository.js");
vi.mock("../../common/logger.js");
vi.mock("../../common/s3-client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchConfigFile: vi.fn(),
}));
vi.mock("../repositories/payment-definition.repository.js");

const code = "gas";
const configVersion = "1.2.3";
const options = { code, configVersion };
const rawDefinition = {
  code,
  sbi: "106284736",
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

const target = (overrides = {}) => ({
  grantCode: code,
  version: configVersion,
  s3Bucket: "bucket",
  s3Key: `${code}/${configVersion}/gas/payment.json`,
  fetchStatus: FetchStatus.Pending,
  fetchAttempts: 0,
  ...overrides,
});

const expectStatus = (fetchStatus, fetchError = undefined) => {
  expect(updateDefinitionFetchStatus).toHaveBeenCalledWith({
    grantCode: code,
    version: configVersion,
    definitionType: "payment",
    fetchStatus,
    fetchError: fetchError ?? null,
  });
};

const expectLogged = (error) => {
  expect(logger.error).toHaveBeenCalledWith(
    { error, event: { action: "payment-definition-load-failed" } },
    `Payment definition load failed for ${code}@${configVersion}`,
  );
};

const duplicateKeyError = () => {
  const error = new MongoServerError("duplicate definition");
  error.code = 11000;
  return error;
};

const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};

describe("loadPaymentDefinition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPaymentDefinitionCaches();
    findConfigDefinition.mockResolvedValue(target());
    findPaymentDefinition.mockResolvedValue(null);
    fetchConfigFile.mockResolvedValue(rawDefinition);
    insertPaymentDefinition.mockResolvedValue({ insertedId: "definition" });
    updateDefinitionFetchStatus.mockResolvedValue({ modifiedCount: 1 });
  });

  it("compiles a stored definition without fetching or inserting it", async () => {
    findConfigDefinition.mockResolvedValue(
      target({ fetchStatus: FetchStatus.Fetched }),
    );
    findPaymentDefinition.mockResolvedValue(rawDefinition);

    const definition = await loadPaymentDefinition(options);

    expect(definition).toBeInstanceOf(PaymentDefinition);
    expect(findPaymentDefinition).toHaveBeenCalledWith(code, configVersion);
    expect(fetchConfigFile).not.toHaveBeenCalled();
    expect(insertPaymentDefinition).not.toHaveBeenCalled();
    expect(updateDefinitionFetchStatus).not.toHaveBeenCalled();
  });

  it("fetches, validates, stores, and marks a missing definition as fetched", async () => {
    const definition = await loadPaymentDefinition(options);

    expect(definition).toBeInstanceOf(PaymentDefinition);
    expect(findConfigDefinition).toHaveBeenCalledWith({
      grantCode: code,
      version: configVersion,
      definitionType: "payment",
    });
    expect(fetchConfigFile).toHaveBeenCalledWith(
      "bucket",
      `${code}/${configVersion}/gas/payment.json`,
    );
    expect(insertPaymentDefinition).toHaveBeenCalledWith({
      code,
      version: configVersion,
      definition: rawDefinition,
    });
    expectStatus(FetchStatus.Fetched);
  });

  it("tolerates a duplicate-key insert from a concurrent process", async () => {
    insertPaymentDefinition.mockRejectedValue(duplicateKeyError());

    await expect(loadPaymentDefinition(options)).resolves.toBeInstanceOf(
      PaymentDefinition,
    );
    expectStatus(FetchStatus.Fetched);
  });

  it("records, logs, and retries a non-duplicate insert failure", async () => {
    const error = new Error("Mongo insert unavailable");
    insertPaymentDefinition
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ insertedId: "definition" });

    await expect(loadPaymentDefinition(options)).rejects.toBe(error);
    expectStatus(FetchStatus.TransientError, error.message);
    expectLogged(error);

    await expect(loadPaymentDefinition(options)).resolves.toBeInstanceOf(
      PaymentDefinition,
    );
    expect(fetchConfigFile).toHaveBeenCalledTimes(2);
    expect(insertPaymentDefinition).toHaveBeenCalledTimes(2);
  });

  it("records, logs, and retries a Mongo read failure", async () => {
    const error = new Error("Mongo read unavailable");
    findPaymentDefinition
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(null);

    await expect(loadPaymentDefinition(options)).rejects.toBe(error);
    expectStatus(FetchStatus.TransientError, error.message);
    expectLogged(error);

    await expect(loadPaymentDefinition(options)).resolves.toBeInstanceOf(
      PaymentDefinition,
    );
    expect(findPaymentDefinition).toHaveBeenCalledTimes(2);
    expect(fetchConfigFile).toHaveBeenCalledOnce();
  });

  it("preserves a load failure when recording its status also fails", async () => {
    const error = new Error("Mongo read unavailable");
    const statusError = new Error("Status write unavailable");
    findPaymentDefinition.mockRejectedValue(error);
    updateDefinitionFetchStatus.mockRejectedValue(statusError);

    await expect(loadPaymentDefinition(options)).rejects.toBe(error);
    expectStatus(FetchStatus.TransientError, error.message);
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      {
        error: statusError,
        event: { action: "payment-definition-status-update-failed" },
      },
      `Payment definition status update failed for ${code}@${configVersion}`,
    );
    expectLogged(error);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing exact catalog entry without Mongo or S3 work", async () => {
    findConfigDefinition.mockResolvedValue(null);

    await expect(loadPaymentDefinition(options)).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 500 },
    });
    expect(findPaymentDefinition).not.toHaveBeenCalled();
    expect(fetchConfigFile).not.toHaveBeenCalled();
    expect(updateDefinitionFetchStatus).not.toHaveBeenCalled();
  });

  it("does not retry a permanently broken target", async () => {
    findConfigDefinition.mockResolvedValue(
      target({ fetchStatus: FetchStatus.PermanentError }),
    );

    await expect(loadPaymentDefinition(options)).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 500 },
    });
    expect(findPaymentDefinition).not.toHaveBeenCalled();
    expect(fetchConfigFile).not.toHaveBeenCalled();
    expect(updateDefinitionFetchStatus).not.toHaveBeenCalled();
  });

  it("records a mismatched code as permanent without storing it", async () => {
    fetchConfigFile.mockResolvedValue({ ...rawDefinition, code: "other" });

    await expect(loadPaymentDefinition(options)).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 500 },
      message: expect.stringContaining('does not match "gas"'),
    });
    expect(insertPaymentDefinition).not.toHaveBeenCalled();
    expectStatus(FetchStatus.PermanentError, expect.any(String));
  });

  it("records malformed raw JSON as a controlled permanent failure", async () => {
    fetchConfigFile.mockResolvedValue(null);

    let error;
    try {
      await loadPaymentDefinition(options);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      isBoom: true,
      output: { statusCode: 500 },
    });
    expect(error).not.toBeInstanceOf(TypeError);
    expect(insertPaymentDefinition).not.toHaveBeenCalled();
    expectStatus(FetchStatus.PermanentError, expect.any(String));
  });

  it.each([
    [
      "permanent",
      new S3FetchError("not found", {
        statusCode: 404,
        code: "NoSuchKey",
        key: target().s3Key,
        bucket: target().s3Bucket,
      }),
      FetchStatus.PermanentError,
    ],
    [
      "parse",
      new S3FetchError("bad json", {
        statusCode: 200,
        code: "PARSE_ERROR",
        key: target().s3Key,
        bucket: target().s3Bucket,
      }),
      FetchStatus.PermanentError,
    ],
    [
      "service",
      new S3FetchError("service unavailable", {
        statusCode: 500,
        code: "SERVICE_ERROR",
        key: target().s3Key,
        bucket: target().s3Bucket,
      }),
      FetchStatus.TransientError,
    ],
  ])("records a %s S3 failure", async (_name, error, status) => {
    fetchConfigFile.mockRejectedValue(error);

    await expect(loadPaymentDefinition(options)).rejects.toBe(error);
    expectStatus(status, error.message);
    expectLogged(error);
  });

  it("returns the same compiled instance on sequential loads", async () => {
    const first = await loadPaymentDefinition(options);
    const second = await loadPaymentDefinition(options);

    expect(second).toBe(first);
    expect(findConfigDefinition).toHaveBeenCalledTimes(2);
    expect(findPaymentDefinition).toHaveBeenCalledOnce();
    expect(fetchConfigFile).toHaveBeenCalledOnce();
    expect(insertPaymentDefinition).toHaveBeenCalledOnce();
  });

  it("shares one persistence path between concurrent loads", async () => {
    const read = deferred();
    findPaymentDefinition.mockReturnValue(read.promise);

    const firstLoad = loadPaymentDefinition(options);
    const secondLoad = loadPaymentDefinition(options);
    await vi.waitFor(() =>
      expect(findPaymentDefinition).toHaveBeenCalledOnce(),
    );
    read.resolve(null);

    const [first, second] = await Promise.all([firstLoad, secondLoad]);
    expect(second).toBe(first);
    expect(findConfigDefinition).toHaveBeenCalledTimes(2);
    expect(findPaymentDefinition).toHaveBeenCalledOnce();
    expect(fetchConfigFile).toHaveBeenCalledOnce();
    expect(insertPaymentDefinition).toHaveBeenCalledOnce();
  });

  it("removes a failed in-flight load so the next call retries", async () => {
    const error = new S3FetchError("temporary failure", {
      statusCode: 500,
      code: "SERVICE_ERROR",
    });
    fetchConfigFile
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(rawDefinition);

    await expect(loadPaymentDefinition(options)).rejects.toBe(error);
    await expect(loadPaymentDefinition(options)).resolves.toBeInstanceOf(
      PaymentDefinition,
    );
    expect(findPaymentDefinition).toHaveBeenCalledTimes(2);
    expect(fetchConfigFile).toHaveBeenCalledTimes(2);
  });

  it("reads Mongo before S3 after process caches are cleared", async () => {
    const first = await loadPaymentDefinition(options);
    clearPaymentDefinitionCaches();
    findPaymentDefinition.mockResolvedValue(rawDefinition);
    findConfigDefinition.mockResolvedValue(
      target({ fetchStatus: FetchStatus.Fetched }),
    );

    const second = await loadPaymentDefinition(options);

    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(PaymentDefinition);
    expect(findConfigDefinition).toHaveBeenCalledTimes(2);
    expect(findPaymentDefinition).toHaveBeenCalledTimes(2);
    expect(fetchConfigFile).toHaveBeenCalledOnce();
    expect(insertPaymentDefinition).toHaveBeenCalledOnce();
  });
});
