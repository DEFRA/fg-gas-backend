import { describe, expect, it } from "vitest";
import { ConfigVersionFiles } from "./config-version-files.js";

const aRow = (overrides = {}) => ({
  _id: "row-1",
  grantCode: "woodland",
  version: "2.0.0",
  major: 2,
  minor: 0,
  patch: 0,
  status: "draft",
  receivedAt: "2026-10-15T10:04:00.000Z",
  s3Bucket: "config-broker-local",
  worstFetchStatus: "permanent_error",
  definitions: {
    grant: {
      s3Key: "woodland/2.0.0/gas.json",
      fetchStatus: "fetched",
      fetchAttempts: 0,
      fetchError: null,
    },
    agreement: {
      s3Key: "woodland/2.0.0/agreement.json",
      fetchStatus: "pending",
      fetchAttempts: 0,
      fetchError: null,
    },
    payment: {
      s3Key: "woodland/2.0.0/payment.json",
      fetchStatus: "permanent_error",
      fetchAttempts: 1,
      fetchError: "invalid",
    },
  },
  ...overrides,
});

const aFile = (stored, fetchStatus, overrides = {}) => ({
  stored,
  fetchStatus,
  fetchError: null,
  fetchAttempts: 0,
  s3Key: "woodland/2.0.0/gas.json",
  ...overrides,
});

const aVersion = (overrides = {}) => ({
  grantCode: "woodland",
  version: "2.0.0",
  status: "draft",
  receivedAt: "2026-10-15T10:04:00.000Z",
  s3Bucket: "config-broker-local",
  worstFetchStatus: "pending",
  files: { grant: aFile(false, "pending") },
  ...overrides,
});

describe("ConfigVersionFiles", () => {
  it("takes each Definition File the row has a location for, with whether it is stored", () => {
    const files = ConfigVersionFiles.fromDocument(
      aRow(),
      new Set(["grant", "payment"]),
    );

    expect({ ...files }).toEqual({
      grantCode: "woodland",
      version: "2.0.0",
      status: "draft",
      receivedAt: "2026-10-15T10:04:00.000Z",
      s3Bucket: "config-broker-local",
      worstFetchStatus: "permanent_error",
      files: {
        grant: {
          stored: true,
          fetchStatus: "fetched",
          fetchAttempts: 0,
          fetchError: null,
          s3Key: "woodland/2.0.0/gas.json",
        },
        agreement: {
          stored: false,
          fetchStatus: "pending",
          fetchAttempts: 0,
          fetchError: null,
          s3Key: "woodland/2.0.0/agreement.json",
        },
        payment: {
          stored: true,
          fetchStatus: "permanent_error",
          fetchAttempts: 1,
          fetchError: "invalid",
          s3Key: "woodland/2.0.0/payment.json",
        },
      },
    });
  });

  it("reads a version not yet stamped with a worst fetch status as null", () => {
    const { worstFetchStatus: _, ...unstamped } = aRow();

    expect(
      ConfigVersionFiles.fromDocument(unstamped, new Set()).worstFetchStatus,
    ).toBeNull();
  });

  it("has no agreement or payment file where the row has no location for one", () => {
    const files = ConfigVersionFiles.fromDocument(
      aRow({
        definitions: {
          grant: {
            s3Key: "woodland/2.0.0/gas.json",
            fetchStatus: "pending",
            fetchAttempts: 0,
            fetchError: null,
          },
        },
      }),
      new Set(),
    );

    expect(Object.keys(files.files)).toEqual(["grant"]);
  });

  it("names the files not stored, grant then agreement then payment", () => {
    const files = new ConfigVersionFiles(
      aVersion({
        files: {
          payment: aFile(false, "pending"),
          agreement: aFile(true, "fetched"),
          grant: aFile(false, "pending"),
        },
      }),
    );

    expect(files.missingFiles()).toEqual(["grant", "payment"]);
  });

  it("names no file, and is all stored, when every one is stored", () => {
    const files = new ConfigVersionFiles(
      aVersion({ files: { grant: aFile(true, "pending") } }),
    );

    expect(files.missingFiles()).toEqual([]);
    expect(files.allStored()).toBe(true);
  });

  it("is not all stored while any file is not", () => {
    const files = new ConfigVersionFiles(
      aVersion({
        files: {
          grant: aFile(true, "fetched"),
          payment: aFile(false, "pending"),
        },
      }),
    );

    expect(files.allStored()).toBe(false);
  });

  it.each([
    ["a version that is not semver", { version: "2.0" }],
    ["an unknown status", { status: "retired" }],
    ["a missing receivedAt", { receivedAt: undefined }],
    ["a receivedAt that is no instant", { receivedAt: "15/10/2026" }],
    ["a missing grant file", { files: { payment: aFile(false, "pending") } }],
    ["an unknown fetch status", { files: { grant: aFile(false, "lost") } }],
    ["an unknown worst fetch status", { worstFetchStatus: "lost" }],
    ["no bucket", { s3Bucket: undefined }],
    ...["fetchError", "fetchAttempts", "s3Key"].map((field) => [
      `a file with no ${field}`,
      { files: { grant: aFile(false, "pending", { [field]: undefined }) } },
    ]),
    ["no worst fetch status", { worstFetchStatus: undefined }],
    [
      "a negative attempt count",
      {
        files: {
          grant: aFile(false, "pending", { fetchAttempts: -1 }),
        },
      },
    ],
    [
      "a file of an unknown type",
      {
        files: {
          grant: aFile(false, "pending"),
          workflow: aFile(false, "pending"),
        },
      },
    ],
  ])("refuses %s", (_, overrides) => {
    expect(() => new ConfigVersionFiles(aVersion(overrides))).toThrow(
      "Invalid ConfigVersionFiles",
    );
  });
});
