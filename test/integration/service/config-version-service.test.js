import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConfigVersion,
  FetchStatus,
} from "../../../src/grants/models/config-version.js";
import {
  findByGrantCodeAndVersion,
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
        s3Key: "woodland/1.0.0/gas/gas.json",
      });

      const result = await upsert(cv);
      expect(result.upsertedCount).toBe(1);

      const doc = await configVersions.findOne({
        grantCode: "woodland",
        version: "1.0.0",
      });
      expect(doc.definitions.grant.fetchStatus).toBe(FetchStatus.Pending);
      expect(doc.definitions.grant.fetchAttempts).toBe(0);
      expect(doc.major).toBe(1);
      expect(doc.fetchStatus).toBeUndefined();
      expect(doc.s3Key).toBe("woodland/1.0.0/gas/gas.json");
    });

    it("should update existing record on duplicate grantCode+version without throwing", async () => {
      const cv = ConfigVersion.createMock({
        grantCode: "woodland",
        version: "1.0.0",
        major: 1,
        minor: 0,
        patch: 0,
        status: "draft",
        s3Key: "woodland/1.0.0/gas/original.json",
      });
      await upsert(cv);

      const updated = ConfigVersion.createMock({
        grantCode: "woodland",
        version: "1.0.0",
        major: 1,
        minor: 0,
        patch: 0,
        status: "active",
        s3Key: "woodland/1.0.0/gas/replacement.json",
      });
      const result = await upsert(updated);
      expect(result.upsertedCount).toBe(0);
      expect(result.modifiedCount).toBe(1);

      const doc = await configVersions.findOne({
        grantCode: "woodland",
        version: "1.0.0",
      });
      expect(doc.status).toBe("active");
      expect(doc.definitions.grant.fetchStatus).toBe(FetchStatus.Pending);
      expect(doc.definitions.grant.s3Key).toBe(
        "woodland/1.0.0/gas/replacement.json",
      );
      expect(doc.fetchStatus).toBeUndefined();
      expect(doc.s3Key).toBe("woodland/1.0.0/gas/original.json");
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
      expect(doc.definitions.grant.fetchStatus).toBe(
        FetchStatus.TransientError,
      );
      expect(doc.definitions.grant.fetchError).toBe("S3 timeout");
      expect(doc.definitions.grant.fetchAttempts).toBe(1);
      expect(doc.definitions.grant.lastFetchAttemptAt).toBeTruthy();
      expect(doc.fetchStatus).toBeUndefined();
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
      expect(doc.definitions.grant.fetchStatus).toBe(FetchStatus.Fetched);
      expect(doc.definitions.grant.fetchedAt).toBeTruthy();
      expect(doc.definitions.grant.fetchAttempts).toBe(0);
      expect(doc.fetchStatus).toBeUndefined();
    });

    it("leaves the Release A top-level state unchanged", async () => {
      const legacyState = {
        s3Key: "woodland/1.0.0/gas/gas.json",
        fetchStatus: FetchStatus.Pending,
        fetchAttempts: 0,
        fetchError: null,
        fetchedAt: null,
        lastFetchAttemptAt: null,
      };
      await configVersions.insertOne({
        grantCode: "woodland",
        version: "1.0.0",
        ...legacyState,
        definitions: { grant: legacyState },
      });

      await updateFetchStatus("woodland", "1.0.0", FetchStatus.Fetched);

      const doc = await configVersions.findOne({
        grantCode: "woodland",
        version: "1.0.0",
      });
      expect(doc).toMatchObject(legacyState);
      expect(doc.definitions.grant.fetchStatus).toBe(FetchStatus.Fetched);
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
