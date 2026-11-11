import { Collection } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ledBucket, testBucket } from "./test-bucket.js";

vi.mock("../logger.js");

const ROWS = 40_000;
const STATUSES = ["COMPLETED", "COMPLETED", "COMPLETED", "DEAD_LETTER"];
const TYPES = ["case.create", "case.update.status"];
const START = Date.UTC(2026, 8, 1);

const bucket = testBucket({
  indexes: [["status"], ["status", "eventType"], ["code"]],
  links: ["application"],
});

// Two rows share each instant, so paging has ties to break on _id.
const row = (n) => ({
  publicationDate: new Date(START + Math.floor(n / 2) * 1000),
  status: STATUSES[n % STATUSES.length],
  eventType: n % 10 === 0 ? "audit" : TYPES[n % 3 === 0 ? 0 : 1],
  grantCode: n % 500 === 7 ? "rare-grant" : "common-grant",
  code: `code-${n % 3}`,
  refs: [
    `ref:record-${n % 5000}`,
    `application:grant-${n % 2}:record-${n % 5000}`,
    `msg:message-${n}`,
  ],
});

let replSet;
let mongoClient;
let db;
let engine;
let schema;

const reads = [];
const find = Collection.prototype.find;

const led = ledBucket();

const parse = (body, from) =>
  engine.parseQuery(from, schema.queryRequestSchema.validate(body).value);

const query = (body, from = bucket) => engine.runQuery(from, parse(body, from));

const stagesOf = (plan) => [
  plan.stage,
  ...[plan.inputStage, ...(plan.inputStages ?? [])]
    .filter(Boolean)
    .flatMap(stagesOf),
];

const explain = async ([filter, options]) => {
  const { queryPlanner, executionStats } = await db
    .collection(bucket.collection)
    .find(filter, options)
    .explain("executionStats");
  const winningPlan =
    queryPlanner.winningPlan.queryPlan ?? queryPlanner.winningPlan;

  return {
    stages: stagesOf(winningPlan),
    rejectedPlans: queryPlanner.rejectedPlans,
    keysExamined: executionStats.totalKeysExamined,
    docsExamined: executionStats.totalDocsExamined,
    returned: executionStats.nReturned,
  };
};

const readsOf = async (body, from) => {
  reads.length = 0;
  const result = await query(body, from);

  return { result, explained: await Promise.all(reads.map(explain)) };
};

const idsOf = ({ rows }) => rows.map(({ id }) => id);

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "bucket-engine-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../mongo-client.js"));
  engine = {
    ...(await import("./engine.js")),
    ...(await import("./catalogue.js")),
    ...(await import("./indexes.js")),
    ...(await import("./summary.js")),
  };
  schema = await import("./schema.js");

  await mongoClient.connect();
  await db
    .collection(bucket.collection)
    .insertMany(Array.from({ length: ROWS }, (_, n) => row(n)));
  await engine.ensureIndexes(db, bucket);
  await engine.ensureIndexes(db, led);

  Collection.prototype.find = function (...args) {
    reads.push(args);
    return find.apply(this, args);
  };
}, 120_000);

afterAll(async () => {
  Collection.prototype.find = find;
  await mongoClient?.close();
  await replSet?.stop();
});

describe("the bucket engine on MongoDB", () => {
  it("builds one plain index per key and none twice", async () => {
    await engine.ensureIndexes(db, bucket);

    const indexes = await db.collection(bucket.collection).indexes();

    expect(indexes.map(({ key }) => Object.keys(key))).toEqual([
      ["_id"],
      ["publicationDate", "_id"],
      ["status", "publicationDate", "_id"],
      ["status", "eventType", "publicationDate", "_id"],
      ["code", "publicationDate", "_id"],
      ["refs", "publicationDate", "_id"],
      ["eventType", "publicationDate", "_id"],
      ["eventType", "status", "publicationDate", "_id"],
      ["eventType", "refs", "publicationDate", "_id"],
    ]);
  });

  it("pages an exact read newest first, with no row repeated or missed", async () => {
    const whole = await query({ limit: 60 });
    const first = await query({});
    const second = await query({ cursor: first.page.next });
    const third = await query({ cursor: second.page.next });

    expect(first.plan.kind).toBe("exact");
    expect([...idsOf(first), ...idsOf(second), ...idsOf(third)]).toEqual(
      idsOf(whole),
    );
    expect(whole.rows.map(({ time }) => time)).toEqual(
      whole.rows.map(({ time }) => time).toSorted((a, b) => b.localeCompare(a)),
    );
  });

  it("pages several values of a fact as one list, newest first, and totals them", async () => {
    const where = { status: ["DEAD_LETTER", "FAILED", "COMPLETED"] };
    const whole = await query({ where, limit: 100 });
    const first = await query({ where, limit: 10, count: true });
    const second = await query({ where, limit: 10, cursor: first.page.next });
    const expected = await db
      .collection(bucket.collection)
      .countDocuments({ status: { $in: where.status } });

    expect(first.plan).toMatchObject({ kind: "exact", bound: ["status"] });
    expect([...idsOf(first), ...idsOf(second)]).toEqual(
      idsOf(whole).slice(0, 20),
    );
    expect(whole.rows.map(({ time }) => time)).toEqual(
      whole.rows.map(({ time }) => time).toSorted((a, b) => b.localeCompare(a)),
    );
    expect(first.total).toEqual({
      count: Math.min(expected, 10_000),
      capped: expected > 10_000,
    });
  });

  it.each([
    ["the time-only line", {}],
    [
      "a fully bound line",
      { where: { status: "DEAD_LETTER", eventType: "case.create" } },
    ],
    ["a line with a filled lead", { where: { eventType: "case.create" } }],
    ["the refs line", { ref: "ref:record-42" }],
    ["the refs line by a link", { ref: "application:grant-0:record-42" }],
  ])(
    "reads %s in order from its index, first page and next",
    async (_, body) => {
      const first = await readsOf(body);
      const next = await readsOf({
        ...body,
        cursor: first.result.page.next ?? undefined,
      });

      for (const { explained, result } of [first, next]) {
        const [page] = explained;

        expect(result.plan.kind).toBe("exact");
        expect(page.stages).not.toContain("SORT");
        expect(page.stages).not.toContain("OR");
        expect(page.stages).not.toContain("COLLSCAN");
        expect(page.rejectedPlans).toEqual([]);
        expect(page.keysExamined).toBeLessThanOrEqual(
          page.returned + result.plan.scans + 3,
        );
      }
    },
  );

  it("returns only rows inside a time range, on the same plan", async () => {
    const from = new Date(START + 1000 * 1000).toISOString();
    const to = new Date(START + 1010 * 1000).toISOString();

    const result = await query({
      where: { status: "DEAD_LETTER" },
      from,
      to,
      limit: 100,
    });

    expect(result.plan.index).toEqual(["status", "publicationDate", "_id"]);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every(({ time }) => time >= from && time <= to)).toBe(
      true,
    );
  });

  it("counts and groups exactly", async () => {
    const collection = db.collection(bucket.collection);
    const result = await query({
      where: { status: "DEAD_LETTER" },
      groupBy: ["status", "eventType", "code"],
    });
    const count = (filter) => collection.countDocuments({ ...filter });

    const deadLetters = {
      count: await count({ status: "DEAD_LETTER" }),
      capped: false,
    };

    expect(result.groups[0].values).toHaveLength(7);
    expect(
      result.groups[0].values.find(({ value }) => value === "FAILED"),
    ).toEqual({
      value: "FAILED",
      count: 0,
      capped: false,
    });
    expect(result.groups[1].values).toEqual([
      {
        value: "case.create",
        count: await count({ status: "DEAD_LETTER", eventType: "case.create" }),
        capped: false,
      },
      {
        value: "case.update.status",
        count: await count({
          status: "DEAD_LETTER",
          eventType: "case.update.status",
        }),
        capped: false,
      },
    ]);
    expect(result.groups[2]).toEqual({
      by: "code",
      values: null,
      total: deadLetters,
    });
    expect(result.groups[0].total).toEqual({ count: 10_000, capped: true });
    expect(result.groups[1].total).toEqual(deadLetters);
  });

  it("totals the list with every filter, and caps a large one", async () => {
    const collection = db.collection(bucket.collection);
    const deadLetters = await query({
      where: { status: "DEAD_LETTER", eventType: "case.create" },
      count: true,
    });
    const everything = await query({ count: true });

    expect(deadLetters.total).toEqual({
      count: await collection.countDocuments({
        status: "DEAD_LETTER",
        eventType: "case.create",
      }),
      capped: false,
    });
    expect(everything.total).toEqual({ count: 10_000, capped: true });
  });

  it("reads stored values with a scan of the fact's own line", async () => {
    const entry = await engine.describeBucket(bucket);

    expect(entry.facts.find(({ name }) => name === "code").values).toEqual([
      { value: "code-0", label: "code-0" },
      { value: "code-1", label: "code-1" },
      { value: "code-2", label: "code-2" },
    ]);
  });

  it("finds exactly the rows that carry a ref", async () => {
    const one = await query({ ref: "msg:message-41" });
    const record = await query({ ref: "ref:Record-42", limit: 100 });

    expect(one.rows).toHaveLength(1);
    expect(record.rows).toHaveLength(
      await db
        .collection(bucket.collection)
        .countDocuments({ refs: "ref:record-42" }),
    );
    expect(record.page.complete).toBe(true);
  });

  it("totals a ref with a type exactly, tested on the ref's rows", async () => {
    const where = { eventType: "case.create" };
    const result = await query({ ref: "ref:record-42", where, count: true });

    expect(result.plan).toMatchObject({
      kind: "exact",
      bound: ["ref"],
      residual: ["eventType"],
    });
    expect(result.total).toEqual({
      count: await db
        .collection(bucket.collection)
        .countDocuments({ refs: "ref:record-42", ...where }),
      capped: false,
    });
  });

  it("tests a fact on a ref's own rows exactly, and is complete", async () => {
    const result = await query({
      ref: "ref:record-42",
      where: { status: "PURGED" },
    });

    expect(result.plan).toMatchObject({ kind: "exact", bound: ["ref"] });
    expect(result.rows).toEqual([]);
    expect(result.page.complete).toBe(true);
  });

  it("bounds a read with a residual by the scan budget and keeps looking to the end", async () => {
    const body = {
      where: { status: "COMPLETED", grantCode: "rare-grant" },
      limit: 100,
    };
    const expected = await db
      .collection(bucket.collection)
      .find({ status: "COMPLETED", grantCode: "rare-grant" })
      .sort({ publicationDate: -1, _id: -1 })
      .toArray();
    const found = [];
    let cursor;
    let requests = 0;

    do {
      const { result, explained } = await readsOf({ ...body, cursor });
      const [edge, page] = explained;

      expect(result.plan).toMatchObject({
        kind: "bounded",
        bound: ["status"],
        residual: ["grantCode"],
      });
      expect(edge.docsExamined).toBe(0);
      expect(page.stages).not.toContain("SORT");
      expect(page.stages).not.toContain("OR");
      expect(page.rejectedPlans).toEqual([]);
      expect(page.keysExamined).toBeLessThanOrEqual(20_000 + 4);

      found.push(...idsOf(result));
      cursor = result.page.next ?? result.page.keepLooking;
      requests += 1;

      if (result.page.keepLooking) {
        expect(result.page.searchedTo).toEqual(expect.any(String));
      }
    } while (cursor);

    expect(requests).toBeGreaterThan(1);
    expect(found).toEqual(expected.map(({ _id }) => _id.toString()));
  });

  it("bounds a read that leads on a filled line the same way", async () => {
    const { result, explained } = await readsOf({
      where: { eventType: "case.create", grantCode: "no-such-grant" },
    });
    const [edge, page] = explained;

    expect(result.plan).toMatchObject({
      kind: "bounded",
      filled: ["status"],
      residual: ["grantCode"],
    });
    expect(edge.docsExamined).toBe(0);
    expect(page.stages).not.toContain("SORT");
    expect(page.stages).not.toContain("OR");
    expect(result.rows).toEqual([]);
  });

  describe("a bucket led by a fact", () => {
    it.each([
      ["the lead filled", {}],
      ["the lead bound", { where: { eventType: "case.create" } }],
      ["audit asked for by name", { where: { eventType: "audit" } }],
      ["a line behind the filled lead", { where: { status: "DEAD_LETTER" } }],
      ["another line behind it", { where: { status: "COMPLETED" } }],
      ["a ref behind the filled lead", { ref: "ref:record-41" }],
      ["another ref behind it", { ref: "ref:record-40" }],
    ])(
      "reads %s in order from its index, first page and next",
      async (_, body) => {
        const first = await readsOf(body, led);
        const next = await readsOf(
          { ...body, cursor: first.result.page.next ?? undefined },
          led,
        );

        for (const { explained, result } of [first, next]) {
          const [page] = explained;

          expect(result.plan.kind).toBe("exact");
          expect(page.stages).not.toContain("SORT");
          expect(page.stages).not.toContain("OR");
          expect(page.stages).not.toContain("COLLSCAN");
          expect(page.rejectedPlans).toEqual([]);
          expect(page.keysExamined).toBeLessThanOrEqual(
            page.returned + result.plan.scans + 3,
          );
        }
      },
    );

    it("reads every row, audit ones too, on the filled lead, and counts them exactly", async () => {
      const collection = db.collection(led.collection);
      const from = new Date(START + 19_900 * 1000).toISOString();
      const where = { status: "COMPLETED" };
      const stored = { ...where, publicationDate: { $gte: new Date(from) } };
      const result = await query(
        { where, from, groupBy: ["eventType"], limit: 100 },
        led,
      );

      expect(
        await collection.countDocuments({ ...stored, eventType: "audit" }),
      ).toBeGreaterThan(0);
      expect(result.plan).toMatchObject({
        index: ["eventType", "status", "publicationDate", "_id"],
        bound: ["status"],
        filled: ["eventType"],
        scans: 4,
      });
      expect(result.rows.some(({ title }) => title === "audit")).toBe(true);
      expect(result.groups[0].total.count).toBe(
        await collection.countDocuments(stored),
      );
    });

    it("counts the tiles over every row", async () => {
      const collection = db.collection(led.collection);
      const from = new Date(START + 19_000 * 1000).toISOString();
      const result = await query({ from, groupBy: ["status"] }, led);
      const sum = result.groups[0].values.reduce(
        (total, { count }) => total + count,
        0,
      );

      expect(sum).toBe(
        await collection.countDocuments({
          publicationDate: { $gte: new Date(from) },
        }),
      );
      expect(result.groups[0].total.count).toBe(sum);
    });

    it("totals a ref search exactly, with a status too, tested on the ref's rows", async () => {
      const collection = db.collection(led.collection);
      const alone = await query({ ref: "ref:record-40", count: true }, led);
      const withStatus = await query(
        { ref: "ref:record-40", where: { status: "COMPLETED" }, count: true },
        led,
      );

      expect(alone.total).toEqual({
        count: await collection.countDocuments({ refs: "ref:record-40" }),
        capped: false,
      });
      expect(withStatus.plan).toMatchObject({
        kind: "exact",
        residual: ["status"],
      });
      expect(withStatus.total).toEqual({
        count: await collection.countDocuments({
          refs: "ref:record-40",
          status: "COMPLETED",
        }),
        capped: false,
      });
      expect(withStatus.rows).toHaveLength(withStatus.total.count);
    });

    it("finds every row of a ref, audit ones too", async () => {
      const collection = db.collection(led.collection);
      const result = await query({ ref: "ref:record-40", limit: 100 }, led);

      expect(result.plan).toMatchObject({
        kind: "exact",
        bound: ["ref"],
        scans: 4,
      });
      expect(result.rows).toHaveLength(
        await collection.countDocuments({ refs: "ref:record-40" }),
      );
      expect(result.page.complete).toBe(true);
    });
  });
});

describe("a summary on MongoDB", () => {
  const summarised = ledBucket({
    indexes: [["status"], ["status", "grantCode"]],
    summaries: [
      {
        id: "errors",
        label: "Errors",
        by: ["grantCode"],
        among: { status: "DEAD_LETTER" },
        top: 20,
        none: "None recorded",
      },
    ],
  });
  const summarise = (body = {}) =>
    engine.runSummary(
      summarised,
      engine.parseSummary(
        summarised,
        "errors",
        schema.summaryRequestSchema.validate(body).value,
      ),
    );

  beforeAll(async () => {
    await engine.ensureIndexes(db, summarised);
  });

  it("counts what a direct count finds, audit rows too, most frequent first", async () => {
    const collection = db.collection(summarised.collection);
    const count = (grantCode) =>
      collection.countDocuments({ status: "DEAD_LETTER", grantCode });

    const result = await summarise();

    expect(
      result.entries.map(({ values, count: n }) => [values.grantCode, n]),
    ).toEqual([
      ["common-grant", await count("common-grant")],
      ["rare-grant", await count("rare-grant")],
    ]);
    expect(result.entries.every(({ capped }) => !capped)).toBe(true);
    expect(result).toMatchObject({ more: false, complete: true });
  });

  it("counts only the rows inside a time range, and says when each was first and last seen", async () => {
    const collection = db.collection(summarised.collection);
    const from = new Date(START + 19_000 * 1000);
    const filter = {
      status: "DEAD_LETTER",
      grantCode: "common-grant",
      publicationDate: { $gte: from },
    };
    const [newest] = await collection
      .find(filter)
      .sort({ publicationDate: -1 })
      .limit(1)
      .toArray();
    const [oldest] = await collection
      .find(filter)
      .sort({ publicationDate: 1 })
      .limit(1)
      .toArray();

    const { entries } = await summarise({
      show: ["eventType"],
      from: from.toISOString(),
    });

    expect(entries[0]).toEqual({
      values: { grantCode: "common-grant" },
      count: await collection.countDocuments(filter),
      capped: false,
      firstAt: oldest.publicationDate.toISOString(),
      lastAt: newest.publicationDate.toISOString(),
    });
  });

  it("steps from one distinct value to the next, fetching no document", async () => {
    const { stages } = await db
      .collection(summarised.collection)
      .aggregate(
        [
          { $match: { eventType: "case.create", status: "DEAD_LETTER" } },
          { $group: { _id: "$grantCode" } },
        ],
        {
          hint: {
            eventType: 1,
            status: 1,
            grantCode: 1,
            publicationDate: -1,
            _id: -1,
          },
        },
      )
      .explain("executionStats");
    const [{ $cursor: cursor }] = stages;

    expect(stagesOf(cursor.queryPlanner.winningPlan)).toContain(
      "DISTINCT_SCAN",
    );
    expect(cursor.executionStats.totalDocsExamined).toBe(0);
    expect(cursor.executionStats.totalKeysExamined).toBeLessThan(10);
  });

  it("reads the first and the last time of a value as one row off the index each, with no sort", async () => {
    reads.length = 0;
    await summarise();
    const explained = await Promise.all(reads.map(explain));

    expect(explained.length).toBe(4);
    for (const read of explained) {
      expect(read.docsExamined).toBe(1);
      expect(read.stages).not.toContain("SORT");
      expect(read.returned).toBe(1);
    }
  });
});
