import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { S3FetchError } from "../../common/s3-client.js";
import { ConfigVersion, FetchStatus } from "../models/config-version.js";
import { Grant } from "../models/grant.js";
import {
  findLatestPatch,
  updateFetchStatus,
} from "../repositories/config-version.repository.js";
import {
  findByCodeAndVersion,
  save,
} from "../repositories/grant.repository.js";
import { resolveAndFetchGrant } from "./resolve-config-version.service.js";

vi.mock("../../common/s3-client.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    fetchConfigFile: vi.fn(),
  };
});
vi.mock(
  "../repositories/config-version.repository.js",
  async (importOriginal) => {
    const original = await importOriginal();
    return {
      ...original,
      findLatestPatch: vi.fn(),
      updateFetchStatus: vi.fn(),
    };
  },
);
vi.mock("../repositories/grant.repository.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    findByCodeAndVersion: vi.fn(),
    save: vi.fn(),
  };
});

const { fetchConfigFile } = await import("../../common/s3-client.js");

const GRANT_CODE = "pigs-might-fly";
const VERSION = "1.0.0";

const mockConfigVersion = (overrides = {}) =>
  ConfigVersion.createMock({
    grantCode: GRANT_CODE,
    version: VERSION,
    fetchStatus: FetchStatus.Pending,
    fetchAttempts: 0,
    ...overrides,
  });

const mockGrantDefinition = {
  code: GRANT_CODE,
  metadata: { description: "Test grant", startDate: "2026-01-01" },
  actions: [],
  phases: [],
};

describe("resolveAndFetchGrant", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects invalid semver version", async () => {
    await expect(resolveAndFetchGrant(GRANT_CODE, "bad")).rejects.toThrow(
      Boom.badRequest("Invalid semver version: bad"),
    );
  });

  it("throws notFound when no active config version exists", async () => {
    findLatestPatch.mockResolvedValue(null);

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 404 }),
      }),
    );
  });

  it("returns cached grant when fetchStatus is fetched and grant exists", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Fetched });
    findLatestPatch.mockResolvedValue(cv);

    const existingGrant = new Grant({
      ...mockGrantDefinition,
      version: VERSION,
    });
    findByCodeAndVersion.mockResolvedValue(existingGrant);

    const result = await resolveAndFetchGrant(GRANT_CODE, VERSION);

    expect(result.grant).toBe(existingGrant);
    expect(result.resolvedVersion).toBe(VERSION);
    expect(fetchConfigFile).not.toHaveBeenCalled();
  });

  it("fetches from S3 when fetchStatus is pending", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Pending });
    findLatestPatch.mockResolvedValue(cv);
    fetchConfigFile.mockResolvedValue(mockGrantDefinition);
    save.mockResolvedValue();
    updateFetchStatus.mockResolvedValue();

    const result = await resolveAndFetchGrant(GRANT_CODE, VERSION);

    expect(fetchConfigFile).toHaveBeenCalledWith(cv.s3Bucket, cv.s3Key);
    expect(save).toHaveBeenCalled();
    expect(updateFetchStatus).toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.Fetched,
    );
    expect(result.grant).toBeInstanceOf(Grant);
    expect(result.resolvedVersion).toBe(VERSION);
  });

  it("fetches from S3 when fetched but grant not found in grants collection", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Fetched });
    findLatestPatch.mockResolvedValue(cv);
    findByCodeAndVersion.mockResolvedValue(null);
    fetchConfigFile.mockResolvedValue(mockGrantDefinition);
    save.mockResolvedValue();
    updateFetchStatus.mockResolvedValue();

    const result = await resolveAndFetchGrant(GRANT_CODE, VERSION);

    expect(fetchConfigFile).toHaveBeenCalled();
    expect(result.grant).toBeInstanceOf(Grant);
  });

  it("throws badGateway on permanent S3 error (NoSuchKey)", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Pending });
    findLatestPatch.mockResolvedValue(cv);

    const s3Err = new S3FetchError("not found", {
      statusCode: 404,
      code: "NoSuchKey",
      key: cv.s3Key,
      bucket: cv.s3Bucket,
    });
    fetchConfigFile.mockRejectedValue(s3Err);
    updateFetchStatus.mockResolvedValue();

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 502 }),
      }),
    );
    expect(updateFetchStatus).toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.PermanentError,
      s3Err.message,
    );
  });

  it("throws badGateway on parse error", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Pending });
    findLatestPatch.mockResolvedValue(cv);

    const s3Err = new S3FetchError("bad json", {
      statusCode: 200,
      code: "PARSE_ERROR",
      key: cv.s3Key,
      bucket: cv.s3Bucket,
    });
    fetchConfigFile.mockRejectedValue(s3Err);
    updateFetchStatus.mockResolvedValue();

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 502 }),
      }),
    );
    expect(updateFetchStatus).toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.PermanentError,
      s3Err.message,
    );
  });

  it("throws serverUnavailable on transient S3 error", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Pending });
    findLatestPatch.mockResolvedValue(cv);

    const s3Err = new S3FetchError("timeout", {
      statusCode: 500,
      code: "SERVICE_ERROR",
      key: cv.s3Key,
      bucket: cv.s3Bucket,
    });
    fetchConfigFile.mockRejectedValue(s3Err);
    updateFetchStatus.mockResolvedValue();

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 503 }),
      }),
    );
    expect(updateFetchStatus).toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.TransientError,
      s3Err.message,
    );
  });

  it("throws badGateway when max fetch attempts exceeded", async () => {
    const cv = mockConfigVersion({
      fetchStatus: FetchStatus.TransientError,
      fetchAttempts: 5,
    });
    findLatestPatch.mockResolvedValue(cv);
    updateFetchStatus.mockResolvedValue();

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 502 }),
      }),
    );
    expect(updateFetchStatus).toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.PermanentError,
      expect.stringContaining("5"),
    );
  });

  it("throws badGateway when fetchStatus is already permanent_error", async () => {
    const cv = mockConfigVersion({
      fetchStatus: FetchStatus.PermanentError,
      fetchError: "previously failed",
    });
    findLatestPatch.mockResolvedValue(cv);

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 502 }),
      }),
    );
    expect(fetchConfigFile).not.toHaveBeenCalled();
  });
});
