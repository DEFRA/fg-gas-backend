import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as addApplicationListIndexes } from "../../migrations/20261002120000-add-application-list-indexes.js";
import { logger } from "../../src/common/logger.js";

const LIST_INDEX = "createdAt_-1__id_-1";
const CODE_INDEX = "code_1_createdAt_-1__id_-1";

let client;
let db;
let applications;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  applications = db.collection("applications");
});

afterAll(async () => {
  await addApplicationListIndexes(db);
  await client?.close();
});

const idAt = (iso) =>
  ObjectId.createFromTime(Math.floor(Date.parse(iso) / 1000));

const seed = (clientRef, createdAt, overrides = {}) => ({
  _id: new ObjectId(),
  clientRef,
  code: "frps-private-beta",
  createdAt,
  ...overrides,
});

const byRef = async () =>
  Object.fromEntries(
    (await applications.find({}).toArray()).map((a) => [a.clientRef, a]),
  );

const indexNames = async () =>
  (await applications.indexes()).map((index) => index.name);

// Mostly another grant, so the grant filter has something to skip.
const seedSpread = () =>
  applications.insertMany(
    Array.from({ length: 60 }, (_, n) =>
      seed(`spread-${n}`, new Date(Date.UTC(2026, 5, 14, n)).toISOString(), {
        code: n % 6 ? "woodland" : "frps-private-beta",
      }),
    ),
  );

const winningPlan = async (filter) =>
  JSON.stringify(
    (
      await applications
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(21)
        .explain("queryPlanner")
    ).queryPlanner.winningPlan,
  );

describe("application list indexes", () => {
  it("exist after the service boots", async () => {
    expect(await indexNames()).toEqual(
      expect.arrayContaining([LIST_INDEX, CODE_INDEX]),
    );
  });

  it("are built when missing", async () => {
    await applications.dropIndex(LIST_INDEX);
    await applications.dropIndex(CODE_INDEX);

    await addApplicationListIndexes(db);

    const keys = (await applications.indexes()).map((index) => index.key);
    expect(keys).toContainEqual({ createdAt: -1, _id: -1 });
    expect(keys).toContainEqual({ code: 1, createdAt: -1, _id: -1 });
  });

  it("are not rebuilt when they already exist, under any name", async () => {
    await applications.dropIndex(CODE_INDEX);
    await applications.createIndex(
      { code: 1, createdAt: -1, _id: -1 },
      { name: "built_out_of_band" },
    );
    const createIndex = vi.spyOn(
      applications.constructor.prototype,
      "createIndex",
    );

    await addApplicationListIndexes(db);

    expect(createIndex).not.toHaveBeenCalled();
    expect(await indexNames()).not.toContain(CODE_INDEX);

    await applications.dropIndex("built_out_of_band");
    await addApplicationListIndexes(db);
  });

  it("refuse an existing index on the list key that is partial", async () => {
    await applications.dropIndex(CODE_INDEX);
    await applications.createIndex(
      { code: 1, createdAt: -1, _id: -1 },
      {
        name: "partial_out_of_band",
        partialFilterExpression: { code: "woodland" },
      },
    );

    await expect(addApplicationListIndexes(db)).rejects.toThrow(
      "Index partial_out_of_band on applications has the list key but is partial or collated",
    );

    await applications.dropIndex("partial_out_of_band");
    await addApplicationListIndexes(db);
  });

  it("log the build time of each index they build", async () => {
    await applications.dropIndex(LIST_INDEX);
    const info = vi.spyOn(logger, "info");

    await addApplicationListIndexes(db);

    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^Built index ${LIST_INDEX} on applications in \\d+ ms$`),
      ),
    );
  });

  it("serve a browse as an index scan with no in-memory sort", async () => {
    await seedSpread();

    const plan = await winningPlan({});

    expect(plan).toContain(LIST_INDEX);
    expect(plan).not.toContain("SORT");
  });

  it("serve a browse by grant over 24 hours as an index scan with no in-memory sort", async () => {
    await seedSpread();

    const plan = await winningPlan({
      code: "frps-private-beta",
      createdAt: {
        $gte: "2026-06-15T10:00:00.000Z",
        $lt: "2026-06-16T10:00:00.000Z",
      },
    });

    expect(plan).toContain(CODE_INDEX);
    expect(plan).not.toContain("SORT");
  });

  it("serve a time range as an index scan with no in-memory sort", async () => {
    await seedSpread();

    const plan = await winningPlan({
      createdAt: {
        $gte: "2026-06-15T10:00:00.000Z",
        $lt: "2026-06-16T10:00:00.000Z",
      },
    });

    expect(plan).toContain(LIST_INDEX);
    expect(plan).not.toContain("SORT");
  });

  it("can be re-applied idempotently", async () => {
    await addApplicationListIndexes(db);
    await addApplicationListIndexes(db);

    expect(await indexNames()).toEqual(
      expect.arrayContaining([LIST_INDEX, CODE_INDEX]),
    );
  });

  it("exports up and nothing else", async () => {
    const migration =
      await import("../../migrations/20261002120000-add-application-list-indexes.js");

    expect(Object.keys(migration)).toEqual(["up"]);
  });
});

describe("normalising application createdAt", () => {
  it("rewrites a Date as the ISO string of that instant", async () => {
    await applications.insertOne(
      seed("date", new Date("2026-06-16T10:04:00.456Z")),
    );

    await addApplicationListIndexes(db);

    expect((await byRef()).date.createdAt).toBe("2026-06-16T10:04:00.456Z");
  });

  it("falls back to the insert instant where there is no created time", async () => {
    await applications.insertMany([
      seed("null", null, { _id: idAt("2026-06-16T10:02:00.000Z") }),
      {
        _id: idAt("2026-06-16T10:01:00.000Z"),
        clientRef: "missing",
        code: "frps-private-beta",
      },
    ]);

    await addApplicationListIndexes(db);

    const rows = await byRef();
    expect(rows.null.createdAt).toBe("2026-06-16T10:02:00.000Z");
    expect(rows.missing.createdAt).toBe("2026-06-16T10:01:00.000Z");
  });

  it("falls back to the migration time when the _id is not an ObjectId", async () => {
    await applications.insertOne({
      _id: "legacy-id",
      clientRef: "legacy",
      code: "frps-private-beta",
    });
    const before = Date.now();

    await addApplicationListIndexes(db);

    const { createdAt } = (await byRef()).legacy;
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(createdAt)).toBeGreaterThan(before - 60_000);
  });

  it("changes no document when every created time is a string", async () => {
    await applications.insertMany([
      seed("canonical", "2026-06-16T10:05:00.123Z"),
      seed("offset", "2026-06-16T11:03:00+01:00"),
    ]);
    const before = await applications.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await addApplicationListIndexes(db);

    expect(await applications.find({}).toArray()).toEqual(before);
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 application createdAt values to ISO strings",
    );
  });
});
