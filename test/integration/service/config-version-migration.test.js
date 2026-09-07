import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { up as backfillGrantDefinition } from "../../../migrations/20260812141750-expand-config-versions-agreement-definitions.js";
import { up as reconcileGrantDefinition } from "../../../migrations/20260907100000-reconcile-config-versions-grant-definitions.js";

let client;
let database;
let configVersions;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  database = client.db(env.MONGO_DATABASE);
  configVersions = database.collection("config_versions");
});

beforeEach(async () => {
  await configVersions.deleteMany({ grantCode: "migration-test" });
});

afterAll(async () => {
  await configVersions.deleteMany({ grantCode: "migration-test" });
  await client?.close();
});

it("idempotently backfills definitions.grant without removing legacy fields", async () => {
  const legacyFetchState = {
    s3Key: "migration-test/1.2.3/gas/gas.json",
    fetchStatus: "fetched",
    fetchAttempts: 2,
    fetchError: null,
    fetchedAt: "2026-08-12T10:00:00.000Z",
    lastFetchAttemptAt: "2026-08-12T10:00:00.000Z",
  };
  await configVersions.insertOne({
    grantCode: "migration-test",
    version: "1.2.3",
    ...legacyFetchState,
  });

  await backfillGrantDefinition(database);
  await backfillGrantDefinition(database);

  const doc = await configVersions.findOne({
    grantCode: "migration-test",
    version: "1.2.3",
  });
  expect(doc).toMatchObject(legacyFetchState);
  expect(doc.definitions.grant).toEqual(legacyFetchState);
});

it("reconciles top-level writes made after the Release A backfill", async () => {
  const legacyFetchState = {
    s3Key: "migration-test/1.2.3/gas/gas.json",
    fetchStatus: "fetched",
    fetchAttempts: 3,
    fetchError: null,
    fetchedAt: "2026-09-07T08:00:00.000Z",
    lastFetchAttemptAt: "2026-09-07T08:00:00.000Z",
  };
  await configVersions.insertOne({
    grantCode: "migration-test",
    version: "1.2.3",
    ...legacyFetchState,
    definitions: {
      grant: {
        ...legacyFetchState,
        fetchStatus: "pending",
        fetchAttempts: 0,
        fetchedAt: null,
        lastFetchAttemptAt: null,
      },
    },
  });

  await reconcileGrantDefinition(database);

  const doc = await configVersions.findOne({
    grantCode: "migration-test",
    version: "1.2.3",
  });
  expect(doc).toMatchObject(legacyFetchState);
  expect(doc.definitions.grant).toEqual(legacyFetchState);
});

it("does not alter nested-only Release B state", async () => {
  const nestedFetchState = {
    s3Key: "migration-test/2.0.0/gas/gas.json",
    fetchStatus: "transient_error",
    fetchAttempts: 1,
    fetchError: "timeout",
    fetchedAt: null,
    lastFetchAttemptAt: "2026-09-07T08:00:00.000Z",
  };
  await configVersions.insertOne({
    grantCode: "migration-test",
    version: "2.0.0",
    definitions: { grant: nestedFetchState },
  });

  await reconcileGrantDefinition(database);

  const doc = await configVersions.findOne({
    grantCode: "migration-test",
    version: "2.0.0",
  });
  expect(doc.definitions.grant).toEqual(nestedFetchState);
});
