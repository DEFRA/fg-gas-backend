import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { S3FetchError } from "../../common/s3-client.js";
import { ConfigVersion, FetchStatus } from "../models/config-version.js";
import { Grant } from "../models/grant.js";
import {
  findLatestForMajor,
  updateFetchStatus,
} from "../repositories/config-version.repository.js";
import {
  findByCode,
  saveFromDefinition,
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
      findLatestForMajor: vi.fn(),
      updateFetchStatus: vi.fn(),
    };
  },
);
vi.mock("../repositories/grant.repository.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    findByCode: vi.fn(),
    saveFromDefinition: vi.fn(),
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
    findLatestForMajor.mockResolvedValue(null);

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 404 }),
      }),
    );
  });

  it("returns cached grant when fetchStatus is fetched and grant exists", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Fetched });
    findLatestForMajor.mockResolvedValue(cv);

    const existingGrant = new Grant({
      ...mockGrantDefinition,
      version: VERSION,
    });
    findByCode.mockResolvedValue(existingGrant);

    const result = await resolveAndFetchGrant(GRANT_CODE, VERSION);

    expect(result.grant).toBe(existingGrant);
    expect(result.resolvedVersion).toBe(VERSION);
    expect(result.definitionSource).toBe("mongodb");
    expect(fetchConfigFile).not.toHaveBeenCalled();
  });

  it("returns cached grant when fetched even if fetchAttempts reached max", async () => {
    const cv = mockConfigVersion({
      fetchStatus: FetchStatus.Fetched,
      fetchAttempts: 5,
    });
    findLatestForMajor.mockResolvedValue(cv);

    const existingGrant = new Grant({
      ...mockGrantDefinition,
      version: VERSION,
    });
    findByCode.mockResolvedValue(existingGrant);

    const result = await resolveAndFetchGrant(GRANT_CODE, VERSION);

    expect(result.grant).toBe(existingGrant);
    expect(fetchConfigFile).not.toHaveBeenCalled();
    expect(updateFetchStatus).not.toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.PermanentError,
      expect.anything(),
    );
  });

  it("fetches from S3 when fetchStatus is pending", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Pending });
    findLatestForMajor.mockResolvedValue(cv);
    fetchConfigFile.mockResolvedValue(mockGrantDefinition);
    const savedGrant = new Grant({ ...mockGrantDefinition, version: VERSION });
    saveFromDefinition.mockResolvedValue(savedGrant);
    updateFetchStatus.mockResolvedValue();

    const result = await resolveAndFetchGrant(GRANT_CODE, VERSION);

    expect(fetchConfigFile).toHaveBeenCalledWith(cv.s3Bucket, cv.s3Key);
    expect(saveFromDefinition).toHaveBeenCalledWith(
      mockGrantDefinition,
      VERSION,
    );
    expect(updateFetchStatus).toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.Fetched,
    );
    expect(result.grant).toBeInstanceOf(Grant);
    expect(result.resolvedVersion).toBe(VERSION);
    expect(result.definitionSource).toBe("s3");
  });

  it("fetches from S3 when fetched but grant not found in grants collection", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Fetched });
    findLatestForMajor.mockResolvedValue(cv);
    findByCode.mockResolvedValue(null);
    fetchConfigFile.mockResolvedValue(mockGrantDefinition);
    const savedGrant = new Grant({ ...mockGrantDefinition, version: VERSION });
    saveFromDefinition.mockResolvedValue(savedGrant);
    updateFetchStatus.mockResolvedValue();

    const result = await resolveAndFetchGrant(GRANT_CODE, VERSION);

    expect(fetchConfigFile).toHaveBeenCalled();
    expect(result.grant).toBeInstanceOf(Grant);
    expect(result.definitionSource).toBe("s3");
  });

  it("handles concurrent duplicate insert by falling back to findByCode", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Pending });
    findLatestForMajor.mockResolvedValue(cv);
    fetchConfigFile.mockResolvedValue(mockGrantDefinition);

    const conflictError = Boom.conflict("already exists");
    saveFromDefinition.mockRejectedValue(conflictError);

    const existingGrant = new Grant({
      ...mockGrantDefinition,
      version: VERSION,
    });
    findByCode.mockResolvedValue(existingGrant);

    const result = await resolveAndFetchGrant(GRANT_CODE, VERSION);

    expect(result.grant).toBe(existingGrant);
    expect(result.resolvedVersion).toBe(VERSION);
    expect(result.definitionSource).toBe("s3");
    expect(updateFetchStatus).toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.Fetched,
    );
  });

  it("latches permanent_error when the fetched grant definition is invalid", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Pending });
    findLatestForMajor.mockResolvedValue(cv);
    fetchConfigFile.mockResolvedValue(mockGrantDefinition);

    // Grant/EntitlementTemplate validation failures surface as
    // Boom.badImplementation, which must not be retried forever.
    const invalidDefinitionError = Boom.badImplementation(
      'Entitlement template "ENT" references position "A:B:C" which does not match any phase:stage:status in "phases"',
    );
    saveFromDefinition.mockRejectedValue(invalidDefinitionError);
    updateFetchStatus.mockResolvedValue();

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      invalidDefinitionError,
    );

    expect(updateFetchStatus).toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.PermanentError,
      invalidDefinitionError.message,
    );
  });

  // saveFromDefinition builds the Grant straight from the parsed JSON without
  // validating its shape, so a malformed definition dies on a plain TypeError
  // rather than a Boom. That still has to latch, or it re-fetches forever.
  it("latches PermanentError when a malformed definition throws a plain TypeError", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Pending });
    findLatestForMajor.mockResolvedValue(cv);
    fetchConfigFile.mockResolvedValue(mockGrantDefinition);

    const malformedError = new TypeError(
      "Cannot read properties of undefined (reading 'description')",
    );
    saveFromDefinition.mockRejectedValue(malformedError);
    updateFetchStatus.mockResolvedValue();

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      malformedError,
    );

    expect(updateFetchStatus).toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.PermanentError,
      malformedError.message,
    );
  });

  // The other side of that: a Mongo failure while saving is transient, so
  // latching it would permanently disable a perfectly good config version.
  it("does not latch when saving fails for a transient reason", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Pending });
    findLatestForMajor.mockResolvedValue(cv);
    fetchConfigFile.mockResolvedValue(mockGrantDefinition);

    const transientError = new Error("connection timed out");
    saveFromDefinition.mockRejectedValue(transientError);
    updateFetchStatus.mockResolvedValue();

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      transientError,
    );

    expect(updateFetchStatus).not.toHaveBeenCalledWith(
      GRANT_CODE,
      VERSION,
      FetchStatus.PermanentError,
      expect.anything(),
    );
  });

  it("throws badGateway on permanent S3 error (NoSuchKey)", async () => {
    const cv = mockConfigVersion({ fetchStatus: FetchStatus.Pending });
    findLatestForMajor.mockResolvedValue(cv);

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
    findLatestForMajor.mockResolvedValue(cv);

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
    findLatestForMajor.mockResolvedValue(cv);

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
    findLatestForMajor.mockResolvedValue(cv);
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
    findLatestForMajor.mockResolvedValue(cv);

    await expect(resolveAndFetchGrant(GRANT_CODE, VERSION)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 502 }),
      }),
    );
    expect(fetchConfigFile).not.toHaveBeenCalled();
  });
});
