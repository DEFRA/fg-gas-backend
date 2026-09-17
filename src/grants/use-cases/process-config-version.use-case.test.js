import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { S3FetchError } from "../../common/s3-client.js";
import { processConfigVersionUseCase } from "./process-config-version.use-case.js";

const { mockConfig } = vi.hoisted(() => {
  const mockConfig = {
    configBroker: {
      variant: "",
    },
  };
  return { mockConfig };
});
vi.mock("../../common/config.js", () => ({
  config: mockConfig,
}));

vi.mock("../../common/logger.js");

const mockUpsert = vi.fn();
vi.mock("../repositories/config-version.repository.js", () => ({
  upsert: (...args) => mockUpsert(...args),
}));

const mockValidateConfigDefinitions = vi.fn();
vi.mock("./validate-config-definitions.js", () => ({
  validateConfigDefinitions: (...args) =>
    mockValidateConfigDefinitions(...args),
}));

describe("processConfigVersionUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ upsertedCount: 1 });
    mockValidateConfigDefinitions.mockResolvedValue(undefined);
    mockConfig.configBroker.variant = "";
  });

  it("should upsert a config version with correct fields", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "1.2.3",
      status: "active",
      path: "configs-bucket",
      manifest: ["woodland/1.2.3/gas/gas.json", "woodland/1.2.3/metadata.json"],
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.grantCode).toBe("woodland");
    expect(arg.version).toBe("1.2.3");
    expect(arg.major).toBe(1);
    expect(arg.minor).toBe(2);
    expect(arg.patch).toBe(3);
    expect(arg.status).toBe("active");
    expect(arg.s3Key).toBe("woodland/1.2.3/gas/gas.json");
    expect(arg.s3Bucket).toBe("configs-bucket");
    expect(arg.fetchStatus).toBe("pending");
    expect(mockUpsert).toHaveBeenCalledWith(arg, {});
  });

  it("should record an optional Agreement definition", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "1.2.3",
      status: "active",
      path: "configs-bucket",
      manifest: [
        "woodland/1.2.3/gas/gas.json",
        "woodland/1.2.3/gas/agreement.json",
      ],
    });

    expect(mockUpsert.mock.calls[0][1]).toEqual({
      agreementS3Key: "woodland/1.2.3/gas/agreement.json",
    });
  });

  it("should record an optional Payment definition", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "1.2.3",
      status: "active",
      path: "configs-bucket",
      manifest: [
        "woodland/1.2.3/gas/gas.json",
        "woodland/1.2.3/gas/payment.json",
      ],
    });

    expect(mockUpsert.mock.calls[0][1]).toEqual({
      paymentS3Key: "woodland/1.2.3/gas/payment.json",
    });
  });

  it("should record Agreement and Payment definitions independently", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "1.2.3",
      status: "active",
      path: "configs-bucket",
      manifest: [
        "woodland/1.2.3/gas/gas.json",
        "woodland/1.2.3/gas/agreement.json",
        "woodland/1.2.3/gas/payment.json",
      ],
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][1]).toEqual({
      agreementS3Key: "woodland/1.2.3/gas/agreement.json",
      paymentS3Key: "woodland/1.2.3/gas/payment.json",
    });
  });

  it("should throw when status is missing", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.0.0",
        path: "configs-bucket",
        manifest: ["woodland/1.0.0/gas/gas.json"],
      }),
    ).rejects.toThrow("invalid status");
  });

  it("should throw when status is not a recognised value", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.0.0",
        status: "published",
        path: "configs-bucket",
        manifest: ["woodland/1.0.0/gas/gas.json"],
      }),
    ).rejects.toThrow("invalid status");
  });

  it("should throw when grantCode is missing", async () => {
    await expect(
      processConfigVersionUseCase({
        version: "1.0.0",
        status: "active",
        path: "configs-bucket",
        manifest: ["woodland/1.0.0/gas/gas.json"],
      }),
    ).rejects.toThrow("missing required fields");
  });

  it("should throw when version is missing", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        status: "active",
        path: "configs-bucket",
        manifest: ["woodland/1.0.0/gas/gas.json"],
      }),
    ).rejects.toThrow("missing required fields");
  });

  it("should throw when manifest is missing", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.0.0",
        status: "active",
        path: "configs-bucket",
      }),
    ).rejects.toThrow("manifest");
  });

  it("should throw when manifest is empty", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.0.0",
        status: "active",
        path: "configs-bucket",
        manifest: [],
      }),
    ).rejects.toThrow("manifest");
  });

  it("should throw for invalid semver version", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "not-a-version",
        status: "active",
        path: "configs-bucket",
        manifest: ["woodland/1.0.0/gas/gas.json"],
      }),
    ).rejects.toThrow("Invalid semver version");
  });

  it("should throw for semver with pre-release suffix", async () => {
    await expect(
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.0.0-rc1",
        status: "active",
        path: "configs-bucket",
        manifest: ["woodland/1.0.0/gas/gas.json"],
      }),
    ).rejects.toThrow("Invalid semver version");
  });

  it("should handle draft status", async () => {
    await processConfigVersionUseCase({
      grantCode: "woodland",
      version: "2.0.0",
      status: "draft",
      path: "configs-bucket",
      manifest: ["woodland/2.0.0/gas/gas.json"],
    });

    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.status).toBe("draft");
  });

  describe("variant behaviour", () => {
    it('passes variant "next" to findS3KeyInManifest for gas.json, agreement.json, and payment.json', async () => {
      mockConfig.configBroker.variant = "next";

      await processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.0.0",
        status: "active",
        path: "configs-bucket",
        manifest: [
          "woodland/1.0.0/gas/gas.next.json",
          "woodland/1.0.0/gas/agreement.next.json",
          "woodland/1.0.0/gas/payment.next.json",
        ],
      });

      const cv = mockUpsert.mock.calls[0][0];
      expect(cv.s3Key).toBe("woodland/1.0.0/gas/gas.next.json");
      expect(mockUpsert.mock.calls[0][1]).toEqual({
        agreementS3Key: "woodland/1.0.0/gas/agreement.next.json",
        paymentS3Key: "woodland/1.0.0/gas/payment.next.json",
      });
    });

    it("passes empty variant to findS3KeyInManifest when variant is empty", async () => {
      mockConfig.configBroker.variant = "";

      await processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.0.0",
        status: "active",
        path: "configs-bucket",
        manifest: ["woodland/1.0.0/gas/gas.json"],
      });

      const cv = mockUpsert.mock.calls[0][0];
      expect(cv.s3Key).toBe("woodland/1.0.0/gas/gas.json");
    });
  });

  describe("s3 bucket", () => {
    const withPath = (path) =>
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.2.3",
        status: "active",
        manifest: ["woodland/1.2.3/gas/gas.json"],
        path,
      });

    it("uses the bucket the Config Broker uploaded to", async () => {
      await withPath("configs-bucket");

      expect(mockUpsert.mock.calls[0][0].s3Bucket).toBe("configs-bucket");
    });

    // There is no configured bucket to fall back to: without a path we would be guessing
    // where the definition lives, so the version is refused instead.
    it.each([
      ["missing", undefined],
      ["empty", ""],
    ])("refuses a version whose path is %s", async (_, path) => {
      await expect(withPath(path)).rejects.toThrow("the bucket is unknown");

      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe("checking the definitions", () => {
    const process = (manifest) =>
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.2.3",
        status: "active",
        path: "configs-bucket",
        manifest,
      });

    it("checks every definition the manifest carries", async () => {
      await process([
        "woodland/1.2.3/gas/gas.json",
        "woodland/1.2.3/gas/agreement.json",
        "woodland/1.2.3/gas/payment.json",
      ]);

      expect(mockValidateConfigDefinitions).toHaveBeenCalledWith({
        grantCode: "woodland",
        version: "1.2.3",
        s3Bucket: "configs-bucket",
        s3Keys: {
          grant: "woodland/1.2.3/gas/gas.json",
          agreement: "woodland/1.2.3/gas/agreement.json",
          payment: "woodland/1.2.3/gas/payment.json",
        },
      });
    });

    it("passes no key for a definition the manifest does not carry", async () => {
      await process(["woodland/1.2.3/gas/gas.json"]);

      expect(mockValidateConfigDefinitions.mock.calls[0][0].s3Keys).toEqual({
        grant: "woodland/1.2.3/gas/gas.json",
        agreement: null,
        payment: null,
      });
    });

    // The whole point of the check: a version we cannot use is never recorded.
    it("does not record the version when a definition cannot be used", async () => {
      mockValidateConfigDefinitions.mockRejectedValueOnce(
        new Error("bad agreement definition"),
      );

      await expect(process(["woodland/1.2.3/gas/gas.json"])).rejects.toThrow(
        "bad agreement definition",
      );

      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe("failures that retrying cannot fix", () => {
    const process = () =>
      processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.2.3",
        status: "active",
        path: "configs-bucket",
        manifest: ["woodland/1.2.3/gas/gas.json"],
      });

    const rejectionFrom = async (error) => {
      mockValidateConfigDefinitions.mockRejectedValueOnce(error);

      return process().catch((thrown) => thrown);
    };

    it("gives up on a definition that will not build", async () => {
      const thrown = await rejectionFrom(
        Boom.badImplementation("definition is invalid"),
      );

      expect(thrown.retryable).toBe(false);
    });

    it("gives up on a message it cannot read", async () => {
      const thrown = await processConfigVersionUseCase({
        grantCode: "woodland",
        version: "1.2.3",
        status: "active",
        manifest: ["woodland/1.2.3/gas/gas.json"],
      }).catch((error) => error);

      expect(thrown.retryable).toBe(false);
    });

    it("gives up on a definition that is missing from S3", async () => {
      const thrown = await rejectionFrom(
        new S3FetchError("not found", { statusCode: 404, code: "NoSuchKey" }),
      );

      expect(thrown.retryable).toBe(false);
    });

    it("keeps retrying when S3 is unavailable", async () => {
      const thrown = await rejectionFrom(
        new S3FetchError("service unavailable", { statusCode: 503 }),
      );

      expect(thrown.retryable).toBeUndefined();
    });

    it("keeps retrying when the database fails", async () => {
      mockUpsert.mockRejectedValueOnce(new Error("mongo is down"));

      const thrown = await process().catch((error) => error);

      expect(thrown.retryable).toBeUndefined();
    });

    // Nothing here throws one today; this is what keeps an outage retryable if one does.
    it("keeps retrying a Boom that means try later", async () => {
      const thrown = await rejectionFrom(Boom.serverUnavailable("try later"));

      expect(thrown.retryable).toBeUndefined();
    });
  });
});
