import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { up as backfillGrantDefinition } from "../../../migrations/20260812141750-expand-config-versions-agreement-definitions.js";
import { up as reconcileGrantDefinition } from "../../../migrations/20260907100000-reconcile-config-versions-grant-definitions.js";
import {
  down as removeLegacyFetchFieldsDown,
  up as removeLegacyFetchFields,
} from "../../../migrations/20260913100000-remove-legacy-config-version-fetch-fields.js";

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

it("removes the legacy top-level fetch fields once definitions.grant is complete", async () => {
  const nestedFetchState = {
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
    ...nestedFetchState,
    definitions: { grant: nestedFetchState },
  });

  await removeLegacyFetchFields(database);

  const doc = await configVersions.findOne({
    grantCode: "migration-test",
    version: "1.2.3",
  });
  expect(doc).not.toHaveProperty("s3Key");
  expect(doc).not.toHaveProperty("fetchStatus");
  expect(doc).not.toHaveProperty("fetchAttempts");
  expect(doc).not.toHaveProperty("fetchError");
  expect(doc).not.toHaveProperty("fetchedAt");
  expect(doc).not.toHaveProperty("lastFetchAttemptAt");
  expect(doc.definitions.grant).toEqual(nestedFetchState);
});

it("leaves a Release-B-native record with no legacy top-level fields untouched", async () => {
  const nestedFetchState = {
    s3Key: "migration-test/3.0.0/gas/gas.json",
    fetchStatus: "fetched",
    fetchAttempts: 0,
    fetchError: null,
    fetchedAt: "2026-09-10T09:00:00.000Z",
    lastFetchAttemptAt: null,
  };
  await configVersions.insertOne({
    grantCode: "migration-test",
    version: "3.0.0",
    definitions: { grant: nestedFetchState },
  });

  await expect(removeLegacyFetchFields(database)).resolves.not.toThrow();

  const doc = await configVersions.findOne({
    grantCode: "migration-test",
    version: "3.0.0",
  });
  expect(doc.definitions.grant).toEqual(nestedFetchState);
});

it("aborts without changing anything when a record has an incomplete definitions.grant", async () => {
  const legacyFetchState = {
    s3Key: "migration-test/9.9.9/gas/gas.json",
    fetchStatus: "fetched",
    fetchAttempts: 1,
    fetchError: null,
    fetchedAt: "2026-09-10T09:00:00.000Z",
    lastFetchAttemptAt: null,
  };
  await configVersions.insertOne({
    grantCode: "migration-test",
    version: "9.9.9",
    ...legacyFetchState,
    // Missing definitions.grant entirely - simulates a record the Release B
    // backfill/reconcile migrations never reached.
  });

  await expect(removeLegacyFetchFields(database)).rejects.toThrow(
    "incomplete definitions.grant",
  );

  const doc = await configVersions.findOne({
    grantCode: "migration-test",
    version: "9.9.9",
  });
  expect(doc).toMatchObject(legacyFetchState);
  expect(doc.definitions).toBeUndefined();
});

it("does not support rolling back the legacy field removal", async () => {
  await expect(removeLegacyFetchFieldsDown()).rejects.toThrow(
    "Not supported",
  );
});
