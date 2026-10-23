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
  definitions: {
    grant: { s3Key: "woodland/2.0.0/gas.json", fetchStatus: "fetched" },
    agreement: {
      s3Key: "woodland/2.0.0/agreement.json",
      fetchStatus: "pending",
    },
    payment: {
      s3Key: "woodland/2.0.0/payment.json",
      fetchStatus: "permanent_error",
    },
  },
  ...overrides,
});

const aVersion = (overrides = {}) => ({
  grantCode: "woodland",
  version: "2.0.0",
  status: "draft",
  receivedAt: "2026-10-15T10:04:00.000Z",
  files: { grant: { stored: false, fetchStatus: "pending" } },
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
      files: {
        grant: { stored: true, fetchStatus: "fetched" },
        agreement: { stored: false, fetchStatus: "pending" },
        payment: { stored: true, fetchStatus: "permanent_error" },
      },
    });
  });

  it("has no agreement or payment file where the row has no location for one", () => {
    const files = ConfigVersionFiles.fromDocument(
      aRow({
        definitions: {
          grant: { s3Key: "woodland/2.0.0/gas.json", fetchStatus: "pending" },
        },
      }),
      new Set(),
    );

    expect(files.files).toEqual({
      grant: { stored: false, fetchStatus: "pending" },
    });
  });

  it.each([
    ["a version that is not semver", { version: "2.0" }],
    ["an unknown status", { status: "retired" }],
    ["a missing receivedAt", { receivedAt: undefined }],
    ["a receivedAt that is no instant", { receivedAt: "15/10/2026" }],
    [
      "a missing grant file",
      { files: { payment: { stored: false, fetchStatus: "pending" } } },
    ],
    [
      "an unknown fetch status",
      { files: { grant: { stored: false, fetchStatus: "lost" } } },
    ],
    [
      "a file of an unknown type",
      {
        files: {
          grant: { stored: false, fetchStatus: "pending" },
          workflow: { stored: false, fetchStatus: "pending" },
        },
      },
    ],
  ])("refuses %s", (_, overrides) => {
    expect(() => new ConfigVersionFiles(aVersion(overrides))).toThrow(
      "Invalid ConfigVersionFiles",
    );
  });
});
