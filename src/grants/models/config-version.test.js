import { describe, expect, it } from "vitest";
import { parseSemver } from "../../common/semver.js";
import { ConfigVersion, FetchStatus } from "./config-version.js";

describe("parseSemver", () => {
  it("should parse a valid semver string", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("should parse version with zeros", () => {
    expect(parseSemver("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it("should parse large version numbers", () => {
    expect(parseSemver("10.20.300")).toEqual({
      major: 10,
      minor: 20,
      patch: 300,
    });
  });

  it("should return null for invalid versions", () => {
    expect(parseSemver("not-a-version")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("1.2.3.4")).toBeNull();
    expect(parseSemver("1.2.3-rc1")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

describe("ConfigVersion.validationSchema", () => {
  const validProps = {
    grantCode: "woodland",
    version: "1.0.0",
    s3Key: "woodland/1.0.0/grant-definition.json",
    s3Bucket: "config-broker-local",
  };

  it("should accept valid props", () => {
    const { error } = ConfigVersion.validationSchema.validate(validProps);
    expect(error).toBeUndefined();
  });

  it("should require grantCode", () => {
    const { grantCode, ...props } = validProps;
    const { error } = ConfigVersion.validationSchema.validate(props);
    expect(error.message).toContain('"grantCode" is required');
  });

  it("should require grantCode to be a string", () => {
    const { error } = ConfigVersion.validationSchema.validate({
      ...validProps,
      grantCode: 123,
    });
    expect(error.message).toContain('"grantCode" must be a string');
  });

  it("should require version", () => {
    const { version, ...props } = validProps;
    const { error } = ConfigVersion.validationSchema.validate(props);
    expect(error.message).toContain('"version" is required');
  });

  it("should require s3Key", () => {
    const { s3Key, ...props } = validProps;
    const { error } = ConfigVersion.validationSchema.validate(props);
    expect(error.message).toContain('"s3Key" is required');
  });

  it("should require s3Bucket", () => {
    const { s3Bucket, ...props } = validProps;
    const { error } = ConfigVersion.validationSchema.validate(props);
    expect(error.message).toContain('"s3Bucket" is required');
  });

  it("should strip unknown properties", () => {
    const { value } = ConfigVersion.validationSchema.validate(
      { ...validProps, unknown: "field" },
      { stripUnknown: true },
    );
    expect(value).not.toHaveProperty("unknown");
  });

  it("should report all errors when abortEarly is false", () => {
    const { error } = ConfigVersion.validationSchema.validate(
      {},
      { abortEarly: false },
    );
    expect(error.details).toHaveLength(4);
  });
});

describe("ConfigVersion", () => {
  describe("new", () => {
    it("should create a new ConfigVersion with parsed semver", () => {
      const cv = ConfigVersion.new({
        grantCode: "woodland",
        version: "1.2.3",
        status: "active",
        s3Key: "woodland/1.2.3/grant-definition.json",
        s3Bucket: "config-broker-local",
      });

      expect(cv.grantCode).toBe("woodland");
      expect(cv.version).toBe("1.2.3");
      expect(cv.major).toBe(1);
      expect(cv.minor).toBe(2);
      expect(cv.patch).toBe(3);
      expect(cv.status).toBe("active");
      expect(cv.fetchStatus).toBe(FetchStatus.Pending);
      expect(cv.fetchAttempts).toBe(0);
      expect(cv.fetchedAt).toBeNull();
      expect(cv.fetchError).toBeNull();
    });

    it("should throw for invalid semver", () => {
      expect(() =>
        ConfigVersion.new({
          grantCode: "woodland",
          version: "not-valid",
          status: "active",
          s3Key: "key",
          s3Bucket: "bucket",
        }),
      ).toThrow("Invalid semver version");
    });
  });

  describe("constructor", () => {
    it("should throw Boom error when required fields are missing", () => {
      expect(() => new ConfigVersion({})).toThrow(
        /Invalid ConfigVersion:.*"grantCode" is required.*"version" is required.*"s3Key" is required.*"s3Bucket" is required/,
      );
    });

    it("should throw when grantCode is missing", () => {
      expect(
        () =>
          new ConfigVersion({
            version: "1.0.0",
            s3Key: "key",
            s3Bucket: "bucket",
          }),
      ).toThrow(/"grantCode" is required/);
    });

    it("should throw when version is missing", () => {
      expect(
        () =>
          new ConfigVersion({
            grantCode: "woodland",
            s3Key: "key",
            s3Bucket: "bucket",
          }),
      ).toThrow(/"version" is required/);
    });
  });

  describe("fromDocument", () => {
    it("should create a ConfigVersion from a document", () => {
      const doc = {
        _id: "abc123",
        grantCode: "woodland",
        version: "1.0.0",
        major: 1,
        minor: 0,
        patch: 0,
        status: "active",
        s3Key: "woodland/1.0.0/grant-definition.json",
        s3Bucket: "config-broker-local",
        receivedAt: "2026-05-13T10:00:00Z",
        fetchedAt: null,
        fetchStatus: FetchStatus.Pending,
        fetchError: null,
        fetchAttempts: 0,
        lastFetchAttemptAt: null,
      };

      const cv = ConfigVersion.fromDocument(doc);
      expect(cv.grantCode).toBe("woodland");
      expect(cv._id).toBe("abc123");
    });

    it("should return null for null input", () => {
      expect(ConfigVersion.fromDocument(null)).toBeNull();
    });
  });

  describe("toDocument", () => {
    it("should return a plain document object", () => {
      const cv = ConfigVersion.new({
        grantCode: "woodland",
        version: "2.1.0",
        status: "active",
        s3Key: "woodland/2.1.0/grant-definition.json",
        s3Bucket: "bucket",
      });

      const doc = cv.toDocument();
      expect(doc.grantCode).toBe("woodland");
      expect(doc.version).toBe("2.1.0");
      expect(doc.major).toBe(2);
      expect(doc.minor).toBe(1);
      expect(doc.patch).toBe(0);
      expect(doc._id).toBeUndefined();
    });
  });

  describe("createMock", () => {
    it("should create a ConfigVersion with sensible defaults", () => {
      const cv = ConfigVersion.createMock();
      expect(cv).toBeInstanceOf(ConfigVersion);
      expect(cv.grantCode).toBe("pigs-might-fly");
      expect(cv.version).toBe("1.0.0");
      expect(cv.fetchStatus).toBe(FetchStatus.Pending);
    });

    it("should allow overriding defaults", () => {
      const cv = ConfigVersion.createMock({
        grantCode: "woodland",
        version: "2.0.0",
        major: 2,
        minor: 0,
        patch: 0,
      });
      expect(cv.grantCode).toBe("woodland");
      expect(cv.version).toBe("2.0.0");
      expect(cv.major).toBe(2);
    });
  });
});
