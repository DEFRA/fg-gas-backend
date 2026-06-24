import { MongoClient } from "mongodb";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  ConfigVersion,
  FetchStatus,
} from "../../../src/grants/models/config-version.js";
import {
  findByGrantCodeAndVersion,
  findLatestPatch,
  updateFetchStatus,
  upsert,
} from "../../../src/grants/repositories/config-version.repository.js";

let client;
let configVersions;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db(env.MONGO_DATABASE);
  configVersions = db.collection("config_versions");
});

beforeEach(async () => {
  await configVersions.deleteMany({});
});

afterEach(async () => {
  await configVersions.deleteMany({});
});

afterAll(async () => {
  await client?.close();
});

describe("config-version repository integration", () => {
  describe("upsert", () => {
    it("should insert a new config version with fetchStatus pending", async () => {
      const cv = ConfigVersion.createMock({
        grantCode: "woodland",
        version: "1.0.0",
        major: 1,
        minor: 0,
        patch: 0,
      });

      const result = await upsert(cv);
      expect(result.upsertedCount).toBe(1);

      const doc = await configVersions.findOne({
        grantCode: "woodland",
        version: "1.0.0",
      });
      expect(doc.fetchStatus).toBe(FetchStatus.Pending);
      expect(doc.fetchAttempts).toBe(0);
      expect(doc.major).toBe(1);
    });

    it("should update existing record on duplicate grantCode+version without throwing", async () => {
      const cv = ConfigVersion.createMock({
        grantCode: "woodland",
        version: "1.0.0",
        major: 1,
        minor: 0,
        patch: 0,
        status: "draft",
      });
      await upsert(cv);

      const updated = ConfigVersion.createMock({
        grantCode: "woodland",
        version: "1.0.0",
        major: 1,
        minor: 0,
        patch: 0,
        status: "active",
      });
      const result = await upsert(updated);
      expect(result.upsertedCount).toBe(0);
      expect(result.modifiedCount).toBe(1);

      const doc = await configVersions.findOne({
        grantCode: "woodland",
        version: "1.0.0",
      });
      expect(doc.status).toBe("active");
      expect(doc.fetchStatus).toBe(FetchStatus.Pending);
    });
  });

  describe("findLatestPatch", () => {
    it("should return the record with the highest patch for active status", async () => {
      await configVersions.insertMany([
        ConfigVersion.createMock({
          grantCode: "woodland",
          version: "1.2.0",
          major: 1,
          minor: 2,
          patch: 0,
          status: "active",
        }).toDocument(),
        ConfigVersion.createMock({
          grantCode: "woodland",
          version: "1.2.3",
          major: 1,
          minor: 2,
          patch: 3,
          status: "active",
        }).toDocument(),
        ConfigVersion.createMock({
          grantCode: "woodland",
          version: "1.2.1",
          major: 1,
          minor: 2,
          patch: 1,
          status: "active",
        }).toDocument(),
      ]);

      const result = await findLatestPatch("woodland", 1, 2);
      expect(result).toBeInstanceOf(ConfigVersion);
      expect(result.version).toBe("1.2.3");
      expect(result.patch).toBe(3);
    });

    it("should skip records with fetchStatus permanent_error", async () => {
      await configVersions.insertMany([
        ConfigVersion.createMock({
          grantCode: "woodland",
          version: "1.2.3",
          major: 1,
          minor: 2,
          patch: 3,
          status: "active",
          fetchStatus: FetchStatus.PermanentError,
        }).toDocument(),
        ConfigVersion.createMock({
          grantCode: "woodland",
          version: "1.2.2",
          major: 1,
          minor: 2,
          patch: 2,
          status: "active",
        }).toDocument(),
      ]);

      const result = await findLatestPatch("woodland", 1, 2);
      expect(result.version).toBe("1.2.2");
    });

    it("should return null when no matching major.minor exists", async () => {
      await configVersions.insertOne(
        ConfigVersion.createMock({
          grantCode: "woodland",
          version: "1.0.0",
          major: 1,
          minor: 0,
          patch: 0,
          status: "active",
        }).toDocument(),
      );

      const result = await findLatestPatch("woodland", 9, 9);
      expect(result).toBeNull();
    });
  });

  describe("updateFetchStatus", () => {
    it("should update fetch fields and increment fetchAttempts", async () => {
      await configVersions.insertOne(
        ConfigVersion.createMock({
          grantCode: "woodland",
          version: "1.0.0",
          major: 1,
          minor: 0,
          patch: 0,
        }).toDocument(),
      );

      await updateFetchStatus(
        "woodland",
        "1.0.0",
        FetchStatus.TransientError,
        "S3 timeout",
      );

      const doc = await configVersions.findOne({
        grantCode: "woodland",
        version: "1.0.0",
      });
      expect(doc.fetchStatus).toBe(FetchStatus.TransientError);
      expect(doc.fetchError).toBe("S3 timeout");
      expect(doc.fetchAttempts).toBe(1);
      expect(doc.lastFetchAttemptAt).toBeTruthy();
    });

    it("should set fetchedAt when status is fetched", async () => {
      await configVersions.insertOne(
        ConfigVersion.createMock({
          grantCode: "woodland",
          version: "1.0.0",
          major: 1,
          minor: 0,
          patch: 0,
        }).toDocument(),
      );

      await updateFetchStatus("woodland", "1.0.0", FetchStatus.Fetched);

      const doc = await configVersions.findOne({
        grantCode: "woodland",
        version: "1.0.0",
      });
      expect(doc.fetchStatus).toBe(FetchStatus.Fetched);
      expect(doc.fetchedAt).toBeTruthy();
    });
  });

  describe("findByGrantCodeAndVersion", () => {
    it("should find a specific version", async () => {
      await configVersions.insertOne(
        ConfigVersion.createMock({
          grantCode: "woodland",
          version: "2.0.0",
          major: 2,
          minor: 0,
          patch: 0,
        }).toDocument(),
      );

      const result = await findByGrantCodeAndVersion("woodland", "2.0.0");
      expect(result).toBeInstanceOf(ConfigVersion);
      expect(result.major).toBe(2);
    });

    it("should return null when not found", async () => {
      const result = await findByGrantCodeAndVersion("woodland", "9.9.9");
      expect(result).toBeNull();
    });
  });
});
