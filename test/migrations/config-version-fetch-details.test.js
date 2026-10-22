import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as normaliseFetchDetails } from "../../migrations/20261027120000-normalise-config-version-fetch-details.js";
import { logger } from "../../src/common/logger.js";

let client;
let configVersions;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  configVersions = client.db().collection("config_versions");
});

afterAll(async () => {
  await client?.close();
});

const aFile = (fields = {}) => ({
  s3Key: "woodland/1.0.0/gas/gas.json",
  fetchStatus: "pending",
  fetchError: null,
  fetchAttempts: 0,
  ...fields,
});

const seed = (version, fields) => ({
  _id: new ObjectId(),
  grantCode: "woodland",
  version,
  status: "active",
  receivedAt: "2026-06-16T10:00:00.000Z",
  s3Bucket: "config-broker-local",
  definitions: { grant: aFile() },
  ...fields,
});

const byVersion = async () =>
  Object.fromEntries(
    (await configVersions.find({ grantCode: "woodland" }).toArray()).map(
      (row) => [row.version, row],
    ),
  );

const migrate = () => normaliseFetchDetails(client.db());

const logged = (files, buckets, left) =>
  `Normalised fetch details on ${files} config version files and the bucket on ${buckets} config versions, ${left} versions of another shape left as stored`;

describe("normalising the fetch details of config versions", () => {
  it("gives a file stored without them no key, no error and no failures", async () => {
    const { s3Key: _k, fetchError: _e, fetchAttempts: _a, ...bare } = aFile();
    await configVersions.insertMany([
      seed("1.0.0", {
        definitions: { grant: aFile(), agreement: bare },
      }),
      seed("1.0.1", {
        definitions: { grant: aFile({ fetchAttempts: null }) },
      }),
    ]);
    const info = vi.spyOn(logger, "info");

    await migrate();

    const rows = await byVersion();
    expect(rows["1.0.0"].definitions.agreement).toEqual({
      fetchStatus: "pending",
      s3Key: null,
      fetchError: null,
      fetchAttempts: 0,
    });
    expect(rows["1.0.1"].definitions.grant.fetchAttempts).toBe(0);
    expect(info).toHaveBeenCalledWith(logged(2, 0, 0));
  });

  it("gives a version stored without a bucket none", async () => {
    const { s3Bucket: _, ...bucketless } = seed("1.0.0", {});
    await configVersions.insertOne(bucketless);

    await migrate();

    expect((await byVersion())["1.0.0"].s3Bucket).toBeNull();
  });

  it("keeps what each file recorded", async () => {
    const recorded = aFile({ fetchError: "$timeout", fetchAttempts: 3 });
    await configVersions.insertOne(
      seed("1.0.0", { definitions: { grant: recorded } }),
    );
    const before = await configVersions.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await configVersions.find({}).toArray()).toEqual(before);
    expect(info).toHaveBeenCalledWith(logged(0, 0, 0));
  });

  it("leaves a value of another shape as stored, and counts its version", async () => {
    await configVersions.insertMany([
      seed("1.0.0", { definitions: { grant: aFile({ fetchAttempts: "2" }) } }),
      seed("1.0.1", { definitions: { grant: aFile({ fetchError: 500 }) } }),
      seed("1.0.2", { s3Bucket: 7 }),
    ]);
    const info = vi.spyOn(logger, "info");

    await migrate();

    const rows = await byVersion();
    expect(rows["1.0.0"].definitions.grant.fetchAttempts).toBe("2");
    expect(rows["1.0.1"].definitions.grant.fetchError).toBe(500);
    expect(rows["1.0.2"].s3Bucket).toBe(7);
    expect(info).toHaveBeenCalledWith(logged(0, 0, 3));
  });

  it("can be re-applied, changing nothing the second time", async () => {
    const { fetchError: _, ...bare } = aFile();
    await configVersions.insertOne(
      seed("1.0.0", { definitions: { grant: bare } }),
    );

    await migrate();
    const once = await configVersions.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await configVersions.find({}).toArray()).toEqual(once);
    expect(info).toHaveBeenCalledWith(logged(0, 0, 0));
  });

  it("exports up and nothing else", async () => {
    const migration =
      await import("../../migrations/20261027120000-normalise-config-version-fetch-details.js");

    expect(Object.keys(migration)).toEqual(["up"]);
  });
});
