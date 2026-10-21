import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as normaliseReceivedAt } from "../../migrations/20261021100000-normalise-config-version-received-at.js";
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

const INSERTED = "2026-06-16T10:00:00.000Z";

const insertedId = () =>
  ObjectId.createFromHexString(
    ObjectId.createFromTime(Date.parse(INSERTED) / 1000)
      .toHexString()
      .slice(0, 8) + new ObjectId().toHexString().slice(8),
  );

const seed = (version, fields) => ({
  _id: insertedId(),
  grantCode: "woodland",
  version,
  status: "active",
  ...fields,
});

const byVersion = async () =>
  Object.fromEntries(
    (await configVersions.find({ grantCode: "woodland" }).toArray()).map(
      (row) => [row.version, row],
    ),
  );

const migrate = () => normaliseReceivedAt(client.db());

describe("normalising config version receivedAt to ISO strings", () => {
  it("gives a version received without a time the time it was first stored", async () => {
    await configVersions.insertMany([
      seed("0.0.0", {}),
      seed("1.0.0", { receivedAt: null }),
    ]);

    await migrate();

    const rows = await byVersion();
    expect(rows["0.0.0"].receivedAt).toBe(INSERTED);
    expect(rows["1.0.0"].receivedAt).toBe(INSERTED);
  });

  it("rewrites a Date, offset or second-precision string as the canonical ISO string of its instant", async () => {
    await configVersions.insertMany([
      seed("1.0.0", { receivedAt: new Date("2026-06-16T10:04:00.456Z") }),
      seed("1.0.1", { receivedAt: "2026-06-16T11:03:00+01:00" }),
      seed("1.0.2", { receivedAt: "2026-01-01T00:00:00Z" }),
    ]);

    await migrate();

    const rows = await byVersion();
    expect(rows["1.0.0"].receivedAt).toBe("2026-06-16T10:04:00.456Z");
    expect(rows["1.0.1"].receivedAt).toBe("2026-06-16T10:03:00.000Z");
    expect(rows["1.0.2"].receivedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("leaves a canonical value as it is", async () => {
    await configVersions.insertOne(
      seed("1.0.0", { receivedAt: "2026-06-16T10:05:00.123Z" }),
    );
    const before = await configVersions.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await configVersions.find({}).toArray()).toEqual(before);
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 config version receivedAt values to ISO strings, 0 not an instant left as stored",
    );
  });

  it("leaves a value that is no instant as stored, and counts it", async () => {
    await configVersions.insertMany([
      seed("1.0.0", { receivedAt: "not-an-instant" }),
      seed("1.0.1", { receivedAt: "2026-13-45" }),
      seed("1.0.2", { receivedAt: "2026-06-16T10:00:01Z" }),
    ]);
    const info = vi.spyOn(logger, "info");

    await migrate();

    const rows = await byVersion();
    expect(rows["1.0.0"].receivedAt).toBe("not-an-instant");
    expect(rows["1.0.1"].receivedAt).toBe("2026-13-45");
    expect(info).toHaveBeenCalledWith(
      "Normalised 1 config version receivedAt values to ISO strings, 2 not an instant left as stored",
    );
  });

  it("can be re-applied, changing nothing the second time", async () => {
    await configVersions.insertMany([
      seed("0.0.0", {}),
      seed("1.0.0", { receivedAt: new Date("2026-06-16T10:04:00.456Z") }),
      seed("1.0.1", { receivedAt: "not-an-instant" }),
    ]);

    await migrate();
    const once = await configVersions.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await configVersions.find({}).toArray()).toEqual(once);
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 config version receivedAt values to ISO strings, 1 not an instant left as stored",
    );
  });

  it("exports up and nothing else", async () => {
    const migration =
      await import("../../migrations/20261021100000-normalise-config-version-received-at.js");

    expect(Object.keys(migration)).toEqual(["up"]);
  });
});
