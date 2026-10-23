import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { up as normaliseConfigVersions } from "../../migrations/20261022110000-normalise-application-config-versions.js";
import { logger } from "../../src/common/logger.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const application = (clientRef, versions) => ({
  clientRef,
  code: "example-grant",
  createdAt: "2026-09-01T10:00:00.000Z",
  ...versions,
});

let replSet;
let client;
let db;

const applications = () => db.collection("applications");

const versionsOf = async (clientRef) =>
  applications().findOne(
    { clientRef },
    {
      projection: {
        _id: 0,
        originalConfigVersion: 1,
        currentConfigVersion: 1,
        configVersion: 1,
      },
    },
  );

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(replSet.getUri());
  db = client.db("application-config-versions-migration");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await db.dropDatabase();
});

describe("normalise application config versions", () => {
  it("moves a legacy config version into the original and current versions", async () => {
    await applications().insertOne(
      application("legacy", { configVersion: "1.1.0" }),
    );

    await normaliseConfigVersions(db);

    expect(await versionsOf("legacy")).toEqual({
      originalConfigVersion: "1.1.0",
      currentConfigVersion: "1.1.0",
    });
  });

  it("keeps the versions an application holds, and drops the legacy one beside them", async () => {
    await applications().insertOne(
      application("both", {
        originalConfigVersion: "1.0.0",
        currentConfigVersion: "1.2.0",
        configVersion: "1.1.0",
      }),
    );

    await normaliseConfigVersions(db);

    expect(await versionsOf("both")).toEqual({
      originalConfigVersion: "1.0.0",
      currentConfigVersion: "1.2.0",
    });
  });

  it("fills a missing current version from the legacy one before the original", async () => {
    await applications().insertOne(
      application("half", {
        originalConfigVersion: "1.0.0",
        configVersion: "1.1.0",
      }),
    );

    await normaliseConfigVersions(db);

    expect(await versionsOf("half")).toEqual({
      originalConfigVersion: "1.0.0",
      currentConfigVersion: "1.1.0",
    });
  });

  it("gives an application never moved on the version it started on", async () => {
    await applications().insertOne(
      application("unresolved", { originalConfigVersion: "1.0.0" }),
    );

    await normaliseConfigVersions(db);

    expect(await versionsOf("unresolved")).toEqual({
      originalConfigVersion: "1.0.0",
      currentConfigVersion: "1.0.0",
    });
  });

  it("gives an application with only a current version 0.0.0 as the one it started on, as the first backfill did", async () => {
    await applications().insertOne(
      application("current-only", { currentConfigVersion: "1.2.0" }),
    );

    await normaliseConfigVersions(db);

    expect(await versionsOf("current-only")).toEqual({
      originalConfigVersion: "0.0.0",
      currentConfigVersion: "1.2.0",
    });
  });

  it("leaves a whole application alone", async () => {
    const whole = application("whole", {
      originalConfigVersion: "1.0.0",
      currentConfigVersion: "1.2.0",
    });
    await applications().insertOne(whole);

    await normaliseConfigVersions(db);

    expect(await applications().findOne({ clientRef: "whole" })).toEqual(whole);
  });

  it("gives an application with no version 0.0.0 and its grant's newest active version, as the first backfill did", async () => {
    await db.collection("config_versions").insertMany([
      {
        grantCode: "example-grant",
        version: "1.10.0",
        status: "active",
        major: 1,
        minor: 10,
        patch: 0,
      },
      {
        grantCode: "example-grant",
        version: "1.9.0",
        status: "active",
        major: 1,
        minor: 9,
        patch: 0,
      },
      {
        grantCode: "example-grant",
        version: "2.0.0",
        status: "permanent_error",
        major: 2,
        minor: 0,
        patch: 0,
      },
    ]);
    await applications().insertMany([
      application("versionless"),
      { ...application("unknown-grant"), code: "unknown-grant" },
    ]);

    await normaliseConfigVersions(db);

    expect(await versionsOf("versionless")).toEqual({
      originalConfigVersion: "0.0.0",
      currentConfigVersion: "1.10.0",
    });
    expect(await versionsOf("unknown-grant")).toEqual({
      originalConfigVersion: "0.0.0",
      currentConfigVersion: "0.0.0",
    });
    expect(logger.info).toHaveBeenLastCalledWith(
      "Normalised 0 legacy and 2 versionless application config versions",
    );
  });

  it("is safe to run again", async () => {
    await applications().insertMany([
      application("legacy", { configVersion: "1.1.0" }),
      application("unresolved", { originalConfigVersion: "1.0.0" }),
      application("current-only", { currentConfigVersion: "1.2.0" }),
      application("versionless"),
    ]);

    await normaliseConfigVersions(db);
    const before = await applications().find().toArray();
    await normaliseConfigVersions(db);

    expect(await applications().find().toArray()).toEqual(before);
    expect(logger.info).toHaveBeenLastCalledWith(
      "Normalised 0 legacy and 0 versionless application config versions",
    );
  });
});
