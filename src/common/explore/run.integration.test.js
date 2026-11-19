import { Collection } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testBucket } from "../buckets/test-bucket.js";
import { partialValue } from "./evaluate.js";
import { checkPart } from "./large-answers.js";
import { inbox, outbox, testSource } from "./test-source.js";

vi.mock("../logger.js");

const OUTBOX_ROWS = 12_000;
const INBOX_ROWS = 10_000;
const START = Date.UTC(2026, 8, 1);
const STATUSES = ["COMPLETED", "COMPLETED", "FAILED", "DEAD_LETTER"];
const TYPES = ["case.create", "case.update.status"];
const SENTINEL = "sentinel-7f3a9c";

const outboxBucket = outbox();
const inboxBucket = inbox();
const source = testSource([outboxBucket, inboxBucket]);

// Two rows share each instant in each box, so paging has ties to break.
const fields = (n) => ({
  status: STATUSES[n % STATUSES.length],
  eventType: TYPES[n % 2],
  code: `code-${n % 3}`,
  version: `1.${n % 2}.0`,
  ref: `record-${n % 500}`,
  grantCode: n % 997 === 7 ? "Rare Grant" : "common grant",
  attempts: n % 7,
  refs: [`ref:record-${n % 500}`, `ref:old-${n}`],
  payload: { answers: { parcels: [{ parcelId: `P${n % 50}`, area: n % 5 }] } },
  note: "a field of many words ".repeat(12),
});

const outboxRow = (n) => ({
  ...fields(n),
  publicationDate: new Date(START + Math.floor(n / 2) * 1000),
});

const inboxRow = (n) => ({
  ...fields(n),
  publicationDate: new Date(
    START + 500 + Math.floor(n / 2) * 1000,
  ).toISOString(),
});

let replSet;
let mongoClient;
let db;
let run;
let merge;
let encodeCursor;
let meterFor;

const query = (overrides = {}) => ({
  v: 2,
  source: "events",
  mode: overrides.groupBy ? "groups" : "rows",
  columns: [{ path: "status" }],
  where: null,
  unwind: [],
  groupBy: null,
  orderBy: null,
  limit: 50,
  positions: null,
  ...overrides,
});

const test = (path, op, ...values) =>
  op === "contains"
    ? { path, op: "regex", values: [{ pattern: values[0], flags: "i" }] }
    : { path, op, values };

const date = (text) => ({ date: text });

const refusal = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error.refusal ?? error;
  }

  return null;
};

const allDocs = async () => [
  ...(await db.collection("outbox").find().toArray()).map((doc) => ({
    doc,
    box: "test.outbox",
  })),
  ...(await db.collection("inbox").find().toArray()).map((doc) => ({
    doc,
    box: "test.inbox",
  })),
];

const truthOf = async (keep) =>
  (await allDocs())
    .filter(({ doc }) => keep(doc))
    .map(({ doc, box }) => ({
      key: {
        t: new Date(doc.publicationDate).toISOString(),
        i: String(doc._id),
        box,
      },
    }))
    .sort((a, b) => merge.compareKeys(a.key, b.key))
    .map(({ key }) => `${key.box}/${key.i}`);

const keepLooking = async (asked) => {
  const seen = [];
  let positions = null;
  let pages = 0;

  for (;;) {
    pages += 1;
    const part = await run.runPart(source, { ...asked, positions });
    const merged = merge.mergeWindowed(part.boxes, asked);

    seen.push(...merged.rows.map(({ box, key }) => `${box}/${key.i}`));

    if (merged.end || pages > 30) {
      return { seen, pages };
    }

    positions = Object.fromEntries(
      Object.entries(merged.positions).map(([id, at]) => [
        id,
        at && encodeCursor(at),
      ]),
    );
  }
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "explore-run-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../mongo-client.js"));
  run = await import("./run.js");
  merge = await import("./merge.js");
  ({ encodeCursor } = await import("../buckets/cursor.js"));
  ({ meterFor } = await import("./meter.js"));
  const { ensureIndexes } = await import("../buckets/indexes.js");

  await mongoClient.connect();
  await db
    .collection("outbox")
    .insertMany(Array.from({ length: OUTBOX_ROWS }, (_, n) => outboxRow(n)));
  await db
    .collection("inbox")
    .insertMany(Array.from({ length: INBOX_ROWS }, (_, n) => inboxRow(n)));
  await ensureIndexes(db, outboxBucket);
  await ensureIndexes(db, inboxBucket);
  await db.collection("things").insertMany([
    {
      _id: "t1",
      ref: "T-1",
      createdAt: "2026-10-01T00:00:00.000Z",
      owner: "o1",
    },
    {
      _id: "t2",
      ref: "T-2",
      createdAt: "2026-10-02T00:00:00.000Z",
      owner: "o2",
    },
  ]);
  await db.collection("owners").insertMany([
    { key: "o1", name: "Hilltop Farm" },
    { key: "o2", name: "Lower Brook" },
  ]);
}, 120_000);

afterAll(async () => {
  await mongoClient?.close();
  await replSet?.stop();
});

describe("runPart on MongoDB", () => {
  describe("a path the source may not read", () => {
    const listed = {
      at: "payload.answers",
      isListed: (path) => path === "parcels",
    };

    it.each([
      ["off its roots", query({ columns: [{ path: "secret" }] }), null],
      [
        "denied",
        query({ where: test("payload.answers.sortCode", "eq", "x") }),
        null,
      ],
      [
        "below its answers and off their list",
        query({ orderBy: { path: "payload.answers.other", desc: false } }),
        listed,
      ],
      [
        "unwound below its answers and off their list",
        query({
          unwind: [{ path: "payload.answers.other", preserve: false }],
        }),
        listed,
      ],
    ])("is refused before any read: %s", async (_, asked, answers) => {
      const find = vi.spyOn(Collection.prototype, "find");
      const count = vi.spyOn(Collection.prototype, "countDocuments");

      expect(
        await refusal(run.runPart(source, asked, undefined, answers)),
      ).toBe("PATH_NOT_ALLOWED");
      expect(find).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();
    });

    it("reads a listed answer", async () => {
      const part = await run.runPart(
        source,
        query({
          columns: [{ path: "payload.answers.parcels" }],
          where: test("status", "eq", "DEAD_LETTER"),
          limit: 1,
        }),
        undefined,
        listed,
      );

      expect(part.boxes.flatMap(({ rows }) => rows)).not.toHaveLength(0);
    });
  });

  it("reads index tests exactly across boxes of either time type, and counts them", async () => {
    const asked = query({ where: test("status", "eq", "DEAD_LETTER") });
    const part = await run.runPart(source, asked);
    const merged = merge.mergeExact(part.boxes, asked);

    expect(part.read).toBe("exact");
    expect(merged.count).toEqual({ n: 5500, capped: false });
    expect(merged.rows.map(({ box, key }) => `${box}/${key.i}`)).toEqual(
      (await truthOf((doc) => doc.status === "DEAD_LETTER")).slice(0, 50),
    );
    expect(merged.rows[0].cells).toEqual({ c0: "DEAD_LETTER" });
  });

  it("bounds the time of a Date box and an ISO text box alike", async () => {
    const [from, to] = ["2026-09-01T00:10:00Z", "2026-09-01T00:30:00Z"];
    const asked = query({
      where: {
        all: [
          test("publicationDate", "gte", date(from)),
          test("publicationDate", "lt", date(to)),
        ],
      },
    });
    const merged = merge.mergeExact(
      (await run.runPart(source, asked)).boxes,
      asked,
    );
    const truth = await truthOf((doc) => {
      const time = new Date(doc.publicationDate);

      return time >= new Date(from) && time < new Date(to);
    });

    expect(merged.count).toEqual({ n: truth.length, capped: false });
    expect(merged.count.n).toBe(4800);
  });

  it("tests a time equal to typed text as text, as mongosh does", async () => {
    const newest = new Date(
      START + 500 + Math.floor((INBOX_ROWS - 1) / 2) * 1000,
    ).toISOString();
    const rowsOf = async (text) => {
      const asked = query({ where: test("publicationDate", "eq", text) });
      const part = await run.runPart(source, asked);

      return {
        read: part.read,
        rows: merge.mergeWindowed(part.boxes, asked).rows.map(({ box }) => box),
      };
    };

    expect(await rowsOf(newest)).toEqual({
      read: "windowed",
      rows: ["test.inbox", "test.inbox"],
    });
    expect(await rowsOf(newest.replace(".500Z", ".5Z"))).toEqual({
      read: "windowed",
      rows: [],
    });
  });

  it("caps an exact count", async () => {
    const merged = merge.mergeExact(
      (await run.runPart(source, query())).boxes,
      query(),
    );

    expect(merged.count).toEqual({ n: 20_000, capped: true });
  });

  it("reads a residual a window at a time, newest first, and Keep looking reaches the end with no row missed or repeated", async () => {
    const asked = query({ where: test("grantCode", "contains", "rare") });
    const first = await run.runPart(source, asked);

    expect(first.read).toBe("windowed");
    expect(first.boxes.map(({ count }) => count)).toEqual([null, null]);

    const { seen, pages } = await keepLooking(asked);

    expect(seen).toEqual(
      await truthOf((doc) => doc.grantCode === "Rare Grant"),
    );
    expect(new Set(seen).size).toBe(seen.length);
    expect(pages).toBeGreaterThan(2);
  });

  it("stops a window at the limit, and goes on from the last row shown", async () => {
    const asked = query({
      where: {
        any: [test("status", "eq", "FAILED"), test("grantCode", "eq", "x")],
      },
      limit: 1000,
    });
    const { seen } = await keepLooking(asked);

    expect(seen).toEqual(await truthOf((doc) => doc.status === "FAILED"));
  });

  it("bounds only a box that stores ISO text by a text bound", async () => {
    const asked = query({
      where: test("publicationDate", "lt", "2026-09-01T00:00:05.000Z"),
    });
    const part = await run.runPart(source, asked);

    expect(part.read).toBe("exact");
    expect(part.boxes.map(({ count }) => count.n)).toEqual([0, 10]);
  });

  it("finds a ref path exactly as stored, case and all, through the refs index", async () => {
    const exact = query({ where: test("ref", "eq", "record-3") });
    const cased = query({ where: test("ref", "eq", "RECORD-3") });
    const part = await run.runPart(source, exact);

    expect(part.read).toBe("exact");
    expect(merge.mergeExact(part.boxes, exact).count.n).toBe(
      (await truthOf((doc) => doc.ref === "record-3")).length,
    );
    expect(
      merge.mergeExact((await run.runPart(source, cased)).boxes, cased).count,
    ).toEqual({ n: 0, capped: false });
  });

  it("tests refs under OR against every ref, earlier ones too", async () => {
    const asked = query({
      where: {
        any: [test("refs", "eq", "ref:old-17"), test("grantCode", "eq", "x")],
      },
    });
    const { seen } = await keepLooking(asked);

    expect(seen).toEqual(
      await truthOf((doc) => doc.refs.includes("ref:old-17")),
    );
  });

  it("reads one ref with facts exactly when its records fit in a window", async () => {
    const asked = query({
      where: {
        all: [test("ref", "eq", "record-3"), test("status", "eq", "FAILED")],
      },
    });
    const part = await run.runPart(source, asked);

    expect(part.read).toBe("exact");
    expect(merge.mergeExact(part.boxes, asked).count.n).toBe(
      (
        await truthOf(
          (doc) => doc.ref === "record-3" && doc.status === "FAILED",
        )
      ).length,
    );
  });

  describe("one ref with facts and a residual", () => {
    const parcelsOf = (doc) =>
      doc.payload.answers.parcels.map(({ parcelId }) => parcelId);
    const residuals = [
      [
        "a value",
        test("grantCode", "eq", "Rare Grant"),
        (doc) => doc.grantCode === "Rare Grant",
      ],
      [
        "$or",
        {
          any: [
            test("grantCode", "eq", "Rare Grant"),
            test("attempts", "eq", 3),
          ],
        },
        (doc) => doc.grantCode === "Rare Grant" || doc.attempts === 3,
      ],
      ["$ne", test("attempts", "ne", 3), (doc) => doc.attempts !== 3],
      ["$exists", test("msg", "filled"), (doc) => doc.msg !== undefined],
      [
        "a pattern",
        test("grantCode", "contains", "rare"),
        (doc) => /rare/i.test(doc.grantCode),
      ],
      [
        "an array path",
        test("payload.answers.parcels.parcelId", "eq", "P7"),
        (doc) => parcelsOf(doc).includes("P7"),
      ],
    ];
    const refTests = [
      ["a ref path", test("ref", "eq", "record-7")],
      ["refs", test("refs", "eq", "ref:record-7")],
    ];

    it.each(
      refTests.flatMap(([refName, ref]) =>
        residuals.map(([name, residual, keep]) => [
          refName,
          name,
          ref,
          residual,
          keep,
        ]),
      ),
    )(
      "tests %s with a fact and %s on every record, windowed",
      async (_, __, ref, residual, keep) => {
        const asked = query({
          where: { all: [ref, test("code", "eq", "code-1"), residual] },
        });
        const truth = await truthOf(
          (doc) => doc.ref === "record-7" && doc.code === "code-1" && keep(doc),
        );

        expect((await run.runPart(source, asked)).read).toBe("windowed");
        expect((await keepLooking(asked)).seen).toEqual(truth);
      },
    );

    it("refuses to count them, as countDocuments needs every test through the index", async () => {
      expect(
        await refusal(
          run.runPart(
            source,
            query({
              mode: "count",
              columns: [{ fn: "count", path: "*" }],
              where: {
                all: [
                  test("ref", "eq", "record-7"),
                  test("code", "eq", "code-1"),
                  test("grantCode", "eq", "Rare Grant"),
                ],
              },
            }),
          ),
        ),
      ).toBe("GROUP_NEEDS_EXACT");
    });
  });

  it("groups an exact read in the evaluator, across boxes", async () => {
    const asked = query({
      columns: [
        { path: "eventType" },
        { fn: "count", path: "*" },
        { fn: "max", path: "publicationDate" },
      ],
      where: test("status", "eq", "DEAD_LETTER"),
      groupBy: { path: "eventType" },
    });
    const part = await run.runPart(source, asked);

    expect(part.boxes.map(({ count }) => count.n)).toEqual([3000, 2500]);
    expect(part.groups).toEqual([
      {
        key: "string:case.update.status",
        value: "case.update.status",
        n: 5500,
        aggs: {
          "count(*)": 5500,
          "max(publicationDate)": { d: "2026-09-01T01:39:59.000Z" },
        },
      },
    ]);
  });

  it("refuses to unwind more records than it may count, every box's together", async () => {
    const asked = query({
      unwind: [{ path: "payload.answers.parcels", preserve: false }],
    });

    expect(OUTBOX_ROWS).toBeLessThan(run.GROUP_CAP);
    expect(INBOX_ROWS).toBeLessThan(run.GROUP_CAP);
    expect(await refusal(run.runPart(source, asked))).toBe("TOO_MANY_TO_COUNT");
  });

  it("refuses to group more records than it may count", async () => {
    const asked = query({
      columns: [{ path: "eventType" }],
      groupBy: { path: "eventType" },
    });

    expect(await refusal(run.runPart(source, asked))).toBe("TOO_MANY_TO_COUNT");
  });

  it("refuses grouping and any order but newest first on a windowed read", async () => {
    const where = test("grantCode", "contains", "rare");

    expect(
      await refusal(
        run.runPart(source, query({ where, groupBy: { path: "eventType" } })),
      ),
    ).toBe("GROUP_NEEDS_EXACT");
    expect(
      await refusal(
        run.runPart(
          source,
          query({
            where,
            orderBy: { path: "attempts", fn: null, desc: true },
          }),
        ),
      ),
    ).toBe("ORDER_NEEDS_EXACT");
  });

  it("sorts an exact read by another field in the evaluator, up to its cap", async () => {
    const asked = query({
      columns: [{ path: "attempts" }],
      where: test("ref", "eq", "record-3"),
      orderBy: { path: "attempts", fn: null, desc: true },
      limit: 5,
    });
    const merged = merge.mergeExact(
      (await run.runPart(source, asked)).boxes,
      asked,
    );

    expect(merged.rows.map(({ cells }) => cells.c0)).toEqual([6, 6, 6, 6, 6]);
    expect(
      await refusal(
        run.runPart(source, {
          ...asked,
          where: test("status", "eq", "COMPLETED"),
        }),
      ),
    ).toBe("TOO_MANY_TO_SORT");
  });

  it("reads the time ascending through the index", async () => {
    const asked = query({
      where: test("ref", "eq", "record-3"),
      orderBy: { path: "publicationDate", fn: null, desc: false },
      limit: 3,
    });
    const merged = merge.mergeExact(
      (await run.runPart(source, asked)).boxes,
      asked,
    );
    const times = merged.rows.map(({ key }) => key.t);

    expect(times).toEqual([...times].sort());
  });

  it("keeps the oldest of tied times first ascending, as each box reads them", async () => {
    const asked = query({
      orderBy: { path: "publicationDate", fn: null, desc: false },
      limit: 2,
    });
    const merged = merge.mergeExact(
      (await run.runPart(source, asked)).boxes,
      asked,
    );
    const oldest = await db
      .collection("outbox")
      .find()
      .sort({ publicationDate: 1, _id: 1 })
      .limit(2)
      .toArray();

    expect(merged.rows.map(({ key }) => key.i)).toEqual(
      oldest.map(({ _id }) => String(_id)),
    );
  });

  it("sorts by an object as Mongo's sort does, not as the {…} it shows", async () => {
    const asked = query({
      where: test("code", "eq", "code-1"),
      columns: [{ path: "payload.answers.parcels.parcelId" }],
      orderBy: { path: "payload", fn: null, desc: false },
      limit: 20,
    });
    const merged = merge.mergeExact(
      (await run.runPart(source, asked)).boxes,
      asked,
    );
    const native = (
      await Promise.all(
        ["outbox", "inbox"].map((name) =>
          db
            .collection(name)
            .find({ code: "code-1" })
            .sort({ payload: 1 })
            .limit(20)
            .toArray(),
        ),
      )
    ).flat();
    const firstOf = (docs) =>
      docs.map(({ payload }) => payload.answers.parcels[0].parcelId);

    expect(merged.rows.map(({ cells }) => cells.c0[0])).toEqual(
      firstOf(native).sort().slice(0, 20),
    );
  });

  it("reads answer paths and aggregates per row", async () => {
    const asked = query({
      columns: [
        { fn: "count", path: "payload.answers.parcels.parcelId" },
        { fn: "sum", path: "payload.answers.parcels.area" },
      ],
      where: test("refs", "eq", "ref:old-12"),
    });
    const merged = merge.mergeExact(
      (await run.runPart(source, asked)).boxes,
      asked,
    );

    expect(merged.rows.map(({ cells }) => cells)).toEqual([
      { c0: 1, c1: 2 },
      { c0: 1, c1: 2 },
    ]);
  });

  it("refuses positions it can't read", async () => {
    expect(
      await refusal(
        run.runPart(
          source,
          query({
            where: test("grantCode", "contains", "rare"),
            positions: { "test.outbox": "not-a-cursor" },
          }),
        ),
      ),
    ).toBe("BAD_POSITION");
  });

  it("answers too slow when Mongo stops the read, and passes on no error text", async () => {
    const spy = vi
      .spyOn(Collection.prototype, "countDocuments")
      .mockRejectedValue(Object.assign(new Error("time limit"), { code: 50 }));

    expect(await refusal(run.runPart(source, query()))).toBe("TOO_SLOW");

    spy.mockRejectedValue(
      Object.assign(new Error(`bad filter ${SENTINEL}`), {
        code: 2,
        codeName: "BadValue",
      }),
    );

    const error = await refusal(run.runPart(source, query()));

    expect(error.message).toBe("Explore read failed");
    expect(JSON.stringify(error)).not.toContain(SENTINEL);
    spy.mockRestore();
  });

  describe("a query that would hold the service", () => {
    const heavy = query({
      where: {
        any: Array.from({ length: 30 }, (_, n) => ({
          path: "note",
          op: "regex",
          values: [{ pattern: `${"x".repeat(40)}(a|b)${n}`, flags: "i" }],
        })),
      },
    });

    // The largest gap between two timer ticks while the read runs.
    const lagDuring = async (run) => {
      let last = Date.now();
      let worst = 0;
      const timer = setInterval(() => {
        worst = Math.max(worst, Date.now() - last);
        last = Date.now();
      }, 5);
      let part = null;
      const outcome = await run().then(
        (answer) => {
          part = answer;

          return null;
        },
        (error) => error.refusal,
      );

      clearInterval(timer);

      return { outcome, worst, part };
    };

    it("stops at its deadline, letting the event loop run meanwhile", async () => {
      const started = Date.now();
      const { outcome, worst } = await lagDuring(() =>
        run.runPart(source, heavy, meterFor(started + 1000, Infinity)),
      );

      expect(outcome).toBe("TOO_SLOW");
      expect(Date.now() - started).toBeLessThan(1500);
      expect(worst).toBeLessThan(100);
    });

    it("costs a list by its values, so the review's 50-value lists stop within the budget", async () => {
      const fifty = (n) =>
        Array.from({ length: 50 }, (_, i) => `${"y".repeat(20)}${n}-${i}`);
      const lists = query({
        where: {
          any: Array.from({ length: 10 }, (_, n) => ({
            path: n % 2 ? "grantCode" : "note",
            op: "in",
            values: fifty(n + 1),
          })),
        },
      });
      const started = Date.now();
      const { outcome, worst, part } = await lagDuring(() =>
        run.runPart(source, lists),
      );

      expect(outcome).toBeNull();
      expect(part.boxes.every(({ partial }) => partial)).toBe(true);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(worst).toBeLessThan(100);
    });

    it("ends a window early when its work budget is spent, at the last record read", async () => {
      const started = Date.now();
      const part = await run.runPart(
        source,
        heavy,
        meterFor(started + 10_000, 300_000),
      );

      expect(part.read).toBe("windowed");
      expect(part.boxes).toHaveLength(2);
      part.boxes.forEach((box) => {
        expect(box).toMatchObject({ partial: true, end: false, rows: [] });
        expect(box.to).not.toBeNull();
      });
      expect(Date.now() - started).toBeLessThan(5000);
    });
  });

  describe("a list of refs, or an OR of them", () => {
    const isRef =
      (...names) =>
      (doc) =>
        names.includes(doc.ref);

    it.each([
      [
        "$in",
        {
          path: "ref",
          op: "in",
          values: ["record-1", "record-2", "record-3"],
        },
        isRef("record-1", "record-2", "record-3"),
      ],
      [
        "$or, a value no record holds now left out",
        {
          any: [
            { path: "ref", op: "eq", values: ["record-4"] },
            { path: "ref", op: "in", values: ["record-5", "old-7"] },
          ],
        },
        isRef("record-4", "record-5"),
      ],
      [
        "an $or of a ref path and refs, whose branches both match one record",
        {
          any: [
            { path: "ref", op: "eq", values: ["record-7"] },
            { path: "refs", op: "eq", values: ["ref:old-7"] },
          ],
        },
        (doc) => doc.ref === "record-7" || doc.refs.includes("ref:old-7"),
      ],
    ])("reads %s exactly, as one index scan a ref", async (_, where, keep) => {
      const asked = query({ where, limit: 5000 });
      const part = await run.runPart(source, asked);
      const rows = merge.mergeExact(part.boxes, asked).rows;

      expect(part.read).toBe("exact");
      expect(rows.map(({ box, key }) => `${box}/${key.i}`)).toEqual(
        await truthOf(keep),
      );
    });
  });

  describe("a later window's reads", () => {
    const later = async () => {
      const asked = query({ where: test("grantCode", "contains", "rare") });
      const first = await run.runPart(source, asked);
      const merged = merge.mergeWindowed(first.boxes, asked);
      const positions = Object.fromEntries(
        Object.entries(merged.positions).map(([id, at]) => [
          id,
          at && encodeCursor(at),
        ]),
      );
      const finds = [];
      const spy = vi
        .spyOn(Collection.prototype, "find")
        .mockImplementation(function (filter, options) {
          finds.push({ collection: this, filter, options });

          return find.call(this, filter, options);
        });

      await run.runPart(source, { ...asked, positions });
      spy.mockRestore();

      return finds;
    };
    const find = Collection.prototype.find;

    const explained = ({ collection, filter, options }) =>
      find
        .call(collection, filter, options)
        .explain("executionStats")
        .then(({ executionStats }) => executionStats);

    it("finds the window's edge from index keys alone, and reads a bounded window", async () => {
      const finds = await later();
      const edges = finds.filter(({ options }) => options.skip);
      const windows = finds.filter(
        ({ options }) => !options.skip && options.projection,
      );

      expect(edges.length).toBeGreaterThan(0);
      expect(windows.length).toBeGreaterThan(0);

      for (const edge of edges) {
        const stats = await explained(edge);

        expect(stats.totalDocsExamined).toBe(0);
        expect(stats.totalKeysExamined).toBeLessThanOrEqual(5001);
      }

      for (const window of windows) {
        const stats = await explained(window);

        // A window is 5,000 records, and a tie at either end at most one more.
        expect(stats.totalKeysExamined).toBeLessThanOrEqual(5003);
        expect(stats.totalDocsExamined).toBeLessThanOrEqual(5002);
      }
    });
  });

  describe("a window that runs out of work", () => {
    const rare = query({
      columns: [{ path: "grantCode" }],
      where: test("grantCode", "contains", "rare"),
    });
    const isRare = (doc) => /rare/i.test(doc.grantCode);

    it("goes on from where it ended, finding every match in order", async () => {
      const seen = [];
      let positions = null;
      let partial = 0;

      for (let page = 0; page < 40; page += 1) {
        const part = await run.runPart(
          source,
          { ...rare, positions },
          meterFor(Date.now() + 10_000, 20_000),
        );
        const merged = merge.mergeWindowed(part.boxes, rare);

        partial += part.boxes.some((box) => box.partial) ? 1 : 0;
        seen.push(...merged.rows.map(({ box, key }) => `${box}/${key.i}`));

        if (merged.end) {
          break;
        }

        positions = Object.fromEntries(
          Object.entries(merged.positions).map(([id, at]) => [
            id,
            at && encodeCursor(at),
          ]),
        );
      }

      expect(partial).toBeGreaterThan(1);
      expect(seen).toEqual(await truthOf(isRare));
    });

    it("reads at least one record a box, with no budget left at all", async () => {
      const part = await run.runPart(
        source,
        rare,
        meterFor(Date.now() + 10_000, 0),
      );

      part.boxes.forEach((box) => {
        expect(box).toMatchObject({ partial: true, end: false });
        expect(box.to).not.toBeNull();
      });
    });

    it("is never an exact read, as groups are: they still refuse", async () => {
      expect(
        await refusal(
          run.runPart(
            source,
            query({
              columns: [{ path: "status" }, { fn: "count", path: "*" }],
              where: test("status", "eq", "DEAD_LETTER"),
              groupBy: { path: "status" },
            }),
            meterFor(Date.now() + 10_000, 0),
          ),
        ),
      ).toBe("TOO_COSTLY");
    });
  });

  describe("a pattern on one long value", () => {
    const LONG = "a".repeat(100_000);

    beforeAll(async () => {
      await db.collection("outbox").insertOne({
        ...fields(1),
        grantCode: LONG,
        publicationDate: new Date(START + 100 * 24 * 3600 * 1000),
      });
    });

    afterAll(async () => {
      await db.collection("outbox").deleteMany({ grantCode: LONG });
    });

    it("is skipped part way as too large to search, never holding the event loop past 100 ms, and Keep looking moves past it", async () => {
      const slow = query({
        columns: [{ path: "grantCode" }],
        where: {
          path: "grantCode",
          op: "regex",
          values: [{ pattern: "(?:(?:a|.){20}){4}z", flags: "" }],
        },
      });
      let last = Date.now();
      let worst = 0;
      const timer = setInterval(() => {
        worst = Math.max(worst, Date.now() - last);
        last = Date.now();
      }, 5);
      const started = Date.now();
      const part = await run.runPart(
        source,
        slow,
        meterFor(Date.now() + 10_000, Infinity),
      );

      clearInterval(timer);

      const skipped = part.boxes.find(({ id }) => id === "test.outbox");

      expect(skipped).toMatchObject({ partial: true, skipped: 1, rows: [] });
      expect(skipped.to.t).toBe(
        new Date(START + 100 * 24 * 3600 * 1000).toISOString(),
      );
      expect(worst).toBeLessThan(100);
      expect(Date.now() - started).toBeLessThan(1000);

      const positions = Object.fromEntries(
        Object.entries(merge.mergeWindowed(part.boxes, slow).positions).map(
          ([id, at]) => [id, at && encodeCursor(at)],
        ),
      );
      const next = await run.runPart(
        source,
        { ...slow, positions },
        meterFor(Date.now() + 10_000, Infinity),
      );

      expect(
        next.boxes.find(({ id }) => id === "test.outbox").skipped ?? 0,
      ).toBe(0);
    });
  });

  it("counts an exact read, capped, across boxes", async () => {
    const part = await run.runPart(
      source,
      query({
        mode: "count",
        columns: [],
        where: test("status", "eq", "DEAD_LETTER"),
      }),
    );

    expect(part.boxes.map(({ count }) => count)).toEqual([
      { n: 3000, capped: false },
      { n: 2500, capped: false },
    ]);
    expect(
      (await run.runPart(source, query({ mode: "count", columns: [] })))
        .boxes[0].count,
    ).toEqual({ n: 10000, capped: true });
  });

  it("refuses to count a windowed read", async () => {
    expect(
      await refusal(
        run.runPart(
          source,
          query({
            mode: "count",
            columns: [],
            where: test("grantCode", "contains", "rare"),
          }),
        ),
      ),
    ).toBe("GROUP_NEEDS_EXACT");
  });

  it("gives the distinct values of a path, records without it adding none", async () => {
    const part = await run.runPart(
      source,
      query({
        mode: "distinct",
        columns: [{ path: "version" }],
        groupBy: { path: "version" },
        where: test("ref", "eq", "record-3"),
      }),
    );

    expect(part.groups.map(({ key }) => key)).toEqual(["string:1.1.0"]);
  });

  it("reads windowed when asked, an exact query too", async () => {
    const part = await run.runPart(
      source,
      query({ where: test("status", "eq", "DEAD_LETTER"), window: true }),
    );

    expect(part.read).toBe("windowed");
    expect(part.boxes.every(({ count }) => count === null)).toBe(true);
  });

  it("says why a read can't group", async () => {
    const error = await run
      .runPart(
        source,
        query({
          where: test("grantCode", "eq", "x"),
          groupBy: { path: "eventType" },
        }),
      )
      .catch((e) => e);

    expect(error).toMatchObject({
      refusal: "GROUP_NEEDS_EXACT",
      detail: { why: "NOT_INDEXED", path: "grantCode" },
    });
  });

  describe("a small source that attaches records", () => {
    const things = {
      name: "things",
      service: "Test",
      size: "small",
      collection: "things",
      time: "createdAt",
      roots: ["ref", "createdAt", "owner.name"],
      answersAt: null,
      attach: [
        {
          as: "owner",
          noun: "owners",
          collection: "owners",
          on: [["owner", "key"]],
        },
      ],
      open: (doc) => ({ kind: "thing", ref: doc.ref }),
      openPaths: ["ref"],
      paths: [{ path: "ref", type: "text" }],
    };
    const ownersRead = (find) =>
      find.mock.contexts
        .map((collection, n) => [collection.collectionName, find.mock.calls[n]])
        .filter(([name]) => name === "owners")
        .map(([, [filter]]) => filter);

    it("reads only the attached records the filtered ones name, when no test reads them", async () => {
      const find = vi.spyOn(Collection.prototype, "find");

      const part = await run.runPart(
        things,
        query({
          source: "things",
          columns: [{ path: "ref" }, { path: "owner.name" }],
          where: test("ref", "eq", "T-2"),
        }),
      );

      expect(part.boxes[0].rows.map(({ cells }) => cells)).toEqual([
        { c0: "T-2", c1: "Lower Brook" },
      ]);
      expect(ownersRead(find)).toEqual([{ key: { $in: ["o2"] } }]);
    });

    it("reads every attached record when a key isn't text or a number", async () => {
      await db.collection("things").insertOne({
        _id: "t3",
        ref: "T-3",
        createdAt: "2026-10-03T00:00:00.000Z",
        owner: { key: "o1" },
      });
      const find = vi.spyOn(Collection.prototype, "find");

      try {
        await run.runPart(
          things,
          query({
            source: "things",
            columns: [{ path: "ref" }, { path: "owner.name" }],
            where: test("ref", "in", "T-1", "T-3"),
          }),
        );
      } finally {
        await db.collection("things").deleteOne({ _id: "t3" });
      }

      expect(ownersRead(find)).toEqual([{}]);
    });

    it("reads no attached record for a count that tests none", async () => {
      const find = vi.spyOn(Collection.prototype, "find");

      const part = await run.runPart(
        things,
        query({
          source: "things",
          mode: "count",
          columns: [{ fn: "count", path: "*" }],
          where: test("ref", "eq", "T-2"),
        }),
      );

      expect(part.boxes[0].count).toEqual({ n: 1, capped: false });
      expect(ownersRead(find)).toEqual([]);
    });

    it("charges each attached record read to the request's work", async () => {
      const spentOn = async (columns) => {
        const meter = meterFor(Date.now() + 10_000);

        await run.runPart(things, query({ source: "things", columns }), meter);

        return meter.spent;
      };

      expect(
        (await spentOn([{ path: "ref" }, { path: "owner.name" }])) -
          (await spentOn([{ path: "ref" }, { path: "createdAt" }])),
      ).toBe(2);
    });
  });

  it("refuses a small source that grew past the full read's cap after it was sized", async () => {
    const grown = {
      name: "grown",
      service: "Test",
      size: "small",
      collection: "grown",
      time: "createdAt",
      roots: ["ref", "createdAt"],
      answersAt: null,
      open: (doc) => ({ kind: "thing", ref: doc.ref }),
      openPaths: ["ref"],
      paths: [{ path: "ref", type: "text" }],
    };
    await db.collection("grown").insertMany(
      Array.from({ length: run.FULL_CAP + 1 }, (_, n) => ({
        ref: `G-${n}`,
        createdAt: "2026-10-01T00:00:00.000Z",
      })),
    );
    vi.spyOn(Collection.prototype, "estimatedDocumentCount").mockResolvedValue(
      run.FULL_CAP,
    );

    expect(
      await refusal(
        run.runPart(
          grown,
          query({ source: "grown", mode: "count", columns: [] }),
        ),
      ),
    ).toBe("TOO_BIG");
  });

  it("reads a small source in full, with what it attaches", async () => {
    const things = {
      name: "things",
      service: "Test",
      size: "small",
      collection: "things",
      time: "createdAt",
      roots: ["ref", "createdAt", "owner.name"],
      answersAt: null,
      attach: [{ as: "owner", collection: "owners", on: [["owner", "key"]] }],
      open: (doc) => ({ kind: "thing", ref: doc.ref }),
      openPaths: ["ref"],
      paths: [{ path: "ref", type: "text" }],
    };
    const part = await run.runPart(
      things,
      query({
        source: "things",
        columns: [{ path: "ref" }, { path: "owner.name" }],
        where: test("owner.name", "contains", "hilltop"),
      }),
    );

    expect(part).toEqual({
      read: "full",
      groups: null,
      boxes: [
        {
          id: "test.things",
          rows: [
            {
              key: { t: "2026-10-01T00:00:00.000Z", i: "t1" },
              open: { kind: "thing", ref: "T-1" },
              cells: { c0: "T-1", c1: "Hilltop Farm" },
              order: null,
            },
          ],
          to: null,
          end: true,
          count: { n: 1, capped: false },
        },
      ],
    });
  });

  describe("$unwind and lists, against Mongo's own aggregate", () => {
    const PARCELS = "payload.answers.parcels";
    const DEAD = { status: "DEAD_LETTER" };
    const unwound = (overrides) =>
      query({
        where: test("status", "eq", "DEAD_LETTER"),
        unwind: [{ path: PARCELS, preserve: false }],
        ...overrides,
      });
    const native = async (pipeline) =>
      (
        await Promise.all(
          ["outbox", "inbox"].map((name) =>
            db.collection(name).aggregate(pipeline).toArray(),
          ),
        )
      ).flat();
    const countsBy = (docs, keyOf, nOf = () => 1) =>
      docs.reduce(
        (counts, doc) => ({
          ...counts,
          [JSON.stringify(keyOf(doc))]:
            (counts[JSON.stringify(keyOf(doc))] ?? 0) + nOf(doc),
        }),
        {},
      );

    it("groups unwound rows as $unwind then $group does", async () => {
      const part = await run.runPart(
        source,
        unwound({
          mode: "groups",
          columns: [
            { path: `${PARCELS}.parcelId` },
            { fn: "count", path: "*" },
            { fn: "sum", path: `${PARCELS}.area` },
          ],
          groupBy: { path: `${PARCELS}.parcelId` },
        }),
      );
      const truth = await native([
        { $match: DEAD },
        { $unwind: `$${PARCELS}` },
        {
          $group: {
            _id: `$${PARCELS}.parcelId`,
            n: { $sum: 1 },
            area: { $sum: `$${PARCELS}.area` },
          },
        },
      ]);

      expect(
        countsBy(
          part.groups,
          ({ value }) => value,
          ({ n }) => n,
        ),
      ).toEqual(
        countsBy(
          truth,
          ({ _id }) => _id,
          ({ n }) => n,
        ),
      );
      expect(
        countsBy(
          part.groups,
          ({ value }) => value,
          ({ aggs }) => aggs[`sum(${PARCELS}.area)`][0],
        ),
      ).toEqual(
        countsBy(
          truth,
          ({ _id }) => _id,
          ({ area }) => area,
        ),
      );
    });

    it("groups by a whole list without $unwind, as $group does", async () => {
      const part = await run.runPart(
        source,
        query({
          mode: "groups",
          where: test("status", "eq", "DEAD_LETTER"),
          columns: [
            { path: `${PARCELS}.parcelId` },
            { fn: "count", path: "*" },
          ],
          groupBy: { path: `${PARCELS}.parcelId` },
        }),
      );
      const truth = await native([
        { $match: DEAD },
        { $group: { _id: `$${PARCELS}.parcelId`, n: { $sum: 1 } } },
      ]);

      expect(part.groups[0].value).toEqual([expect.any(String)]);
      expect(
        countsBy(
          part.groups,
          ({ value }) => value,
          ({ n }) => n,
        ),
      ).toEqual(
        countsBy(
          truth,
          ({ _id }) => _id,
          ({ n }) => n,
        ),
      );
    });

    it("adds decimals as mongod's $sum does, to the last digit", async () => {
      let seed = 7;
      const random = () => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;

        return seed / 2_147_483_648;
      };
      await db.collection("floats").insertMany(
        Array.from({ length: 500 }, (_, n) => ({
          ref: `F-${n}`,
          group: `g${n % 7}`,
          createdAt: "2026-10-01T00:00:00.000Z",
          x: Math.round(random() * 1e6) / 1e4,
          xs: Array.from(
            { length: 1 + (n % 12) },
            () => Math.round(random() * 1e6) / 1e4 - 25,
          ),
        })),
      );
      const floats = {
        name: "floats",
        service: "Test",
        size: "small",
        collection: "floats",
        time: "createdAt",
        roots: ["ref", "group", "createdAt", "x", "xs"],
        answersAt: null,
        open: (doc) => ({ kind: "float", ref: doc.ref }),
        openPaths: ["ref"],
        paths: [{ path: "ref", type: "text" }],
      };
      const rows = await run.runPart(
        floats,
        query({
          source: "floats",
          columns: [{ path: "ref" }, { fn: "sum", path: "xs" }],
          limit: 500,
        }),
      );
      const groups = await run.runPart(
        floats,
        query({
          source: "floats",
          mode: "groups",
          columns: [{ path: "group" }, { fn: "sum", path: "x" }],
          groupBy: { path: "group" },
        }),
      );
      const projected = await db
        .collection("floats")
        .aggregate([{ $project: { ref: 1, s: { $sum: "$xs" } } }])
        .toArray();
      const grouped = await db
        .collection("floats")
        .aggregate([{ $group: { _id: "$group", s: { $sum: "$x" } } }])
        .toArray();

      expect(
        Object.fromEntries(
          rows.boxes[0].rows.map(({ cells }) => [cells.c0, cells.c1]),
        ),
      ).toEqual(Object.fromEntries(projected.map(({ ref, s }) => [ref, s])));
      expect(
        Object.fromEntries(
          groups.groups.map(({ value, aggs }) => [value, aggs["sum(x)"][0]]),
        ),
      ).toEqual(Object.fromEntries(grouped.map(({ _id, s }) => [_id, s])));
    });

    it("falls back to a plain sum when a sum overflows, as mongod's $sum does", async () => {
      await db.collection("overflow").insertMany(
        [1e308, 1e308, 1].map((x, n) => ({
          ref: `O-${n}`,
          group: "g",
          createdAt: "2026-10-01T00:00:00.000Z",
          x,
          xs: [1e308, 1e308, 1],
        })),
      );
      const overflow = {
        name: "overflow",
        service: "Test",
        size: "small",
        collection: "overflow",
        time: "createdAt",
        roots: ["ref", "group", "createdAt", "x", "xs"],
        answersAt: null,
        open: (doc) => ({ kind: "overflow", ref: doc.ref }),
        openPaths: ["ref"],
        paths: [{ path: "ref", type: "text" }],
      };
      const rows = await run.runPart(
        overflow,
        query({
          source: "overflow",
          columns: [{ path: "ref" }, { fn: "sum", path: "xs" }],
        }),
      );
      const groups = await run.runPart(
        overflow,
        query({
          source: "overflow",
          mode: "groups",
          columns: [{ path: "group" }, { fn: "sum", path: "x" }],
          groupBy: { path: "group" },
        }),
      );
      const [projected] = await db
        .collection("overflow")
        .aggregate([{ $project: { s: { $sum: "$xs" } } }])
        .toArray();
      const [grouped] = await db
        .collection("overflow")
        .aggregate([{ $group: { _id: "$group", s: { $sum: "$x" } } }])
        .toArray();

      expect(projected.s).toBe(Infinity);
      expect(grouped.s).toBe(Infinity);
      expect(rows.boxes[0].rows[0].cells.c1).toBe(String(projected.s));
      expect(partialValue("sum", groups.groups[0].aggs["sum(x)"])).toBe(
        grouped.s,
      );
    });

    it("adds a group's sums across boxes as mongod does, an overflow in either box, sent through JSON", async () => {
      const boxes = ["sums.first", "sums.second"].map((id) =>
        testBucket({ id, path: id.replace(".", "/"), collection: id }),
      );
      const { ensureIndexes } = await import("../buckets/indexes.js");
      const rowOf = (status, attempts) => ({
        status,
        attempts,
        publicationDate: new Date(START),
      });
      await db
        .collection("sums.first")
        .insertMany([
          rowOf("DEAD_LETTER", 1e308),
          rowOf("DEAD_LETTER", 1e308),
          rowOf("FAILED", 1e308),
        ]);
      await db
        .collection("sums.second")
        .insertMany([rowOf("DEAD_LETTER", 5), rowOf("FAILED", 1e308)]);
      await Promise.all(boxes.map((bucket) => ensureIndexes(db, bucket)));
      const truth = await db
        .collection("sums.first")
        .aggregate([
          { $unionWith: "sums.second" },
          { $group: { _id: "$status", s: { $sum: "$attempts" } } },
        ])
        .toArray();
      const sums = {
        columns: [{ path: "status" }, { fn: "sum", path: "attempts" }],
        groupBy: { path: "status" },
      };

      for (const order of [boxes, boxes.toReversed()]) {
        const part = await run.runPart(testSource(order), query(sums));
        const received = await checkPart(JSON.parse(JSON.stringify(part)));

        await expect(checkPart(part)).resolves.toBeDefined();
        expect(
          Object.fromEntries(
            received.groups.map(({ value, aggs }) => [
              value,
              partialValue("sum", aggs["sum(attempts)"]),
            ]),
          ),
        ).toEqual(Object.fromEntries(truth.map(({ _id, s }) => [_id, s])));
      }
      expect(truth.map(({ s }) => s)).toEqual([Infinity, Infinity]);
    });

    it("works out $size and $sum per record as $project does", async () => {
      const part = await run.runPart(
        source,
        query({
          where: test("status", "eq", "DEAD_LETTER"),
          columns: [
            { fn: "count", path: PARCELS },
            { fn: "sum", path: `${PARCELS}.area` },
            { path: `${PARCELS}.parcelId` },
          ],
          limit: 200,
        }),
      );
      const truth = new Map(
        (
          await native([
            { $match: DEAD },
            {
              $project: {
                size: { $size: `$${PARCELS}` },
                sum: { $sum: `$${PARCELS}.area` },
                ids: `$${PARCELS}.parcelId`,
              },
            },
          ])
        ).map(({ _id, size, sum, ids }) => [
          String(_id),
          { c0: size, c1: sum, c2: ids },
        ]),
      );
      const rows = part.boxes.flatMap((box) => box.rows);

      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((row) => expect(row.cells).toEqual(truth.get(row.key.i)));
    });

    it("makes rows of each element, sorted and cut, and counts the rows", async () => {
      const part = await run.runPart(
        source,
        unwound({
          columns: [{ path: "ref" }, { path: `${PARCELS}.parcelId` }],
          orderBy: { path: `${PARCELS}.parcelId`, fn: null, desc: true },
          limit: 7,
        }),
      );
      const truth = await native([
        { $match: DEAD },
        { $unwind: `$${PARCELS}` },
        { $sort: { [`${PARCELS}.parcelId`]: -1 } },
        { $limit: 7 },
      ]);

      expect(part.boxes.map(({ count }) => count.n)).toEqual([3000, 2500]);
      expect(part.boxes.every(({ rows: kept }) => kept.length === 7)).toBe(
        true,
      );
      expect(
        part.boxes
          .flatMap((box) => box.rows)
          .map(({ cells }) => cells.c1)
          .sort()
          .reverse()
          .slice(0, 7),
      ).toEqual(
        truth
          .map((doc) => doc.payload.answers.parcels.parcelId)
          .sort()
          .reverse()
          .slice(0, 7),
      );
    });

    it("stops at the work budget when unwinding makes too many rows", async () => {
      expect(
        await refusal(
          run.runPart(
            source,
            unwound({ columns: [{ path: "ref" }] }),
            meterFor(Date.now() + 10_000, 1000),
          ),
        ),
      ).toBe("TOO_COSTLY");
    });

    it("unwinds a long list over many slices of time, letting others in, and answers", async () => {
      await db.collection("lists").insertOne({
        _id: "l1",
        ref: "L-1",
        createdAt: "2026-10-01T00:00:00.000Z",
        parts: Array.from({ length: 60_000 }, (_, n) => ({
          code: `c${n % 3}`,
          secret: { sortCode: String(n % 2) },
        })),
      });
      const lists = {
        name: "lists",
        service: "Test",
        size: "small",
        collection: "lists",
        time: "createdAt",
        roots: ["ref", "createdAt", "parts"],
        answersAt: null,
        open: (doc) => ({ kind: "list", ref: doc.ref }),
        openPaths: ["ref"],
        paths: [{ path: "ref", type: "text" }],
      };
      let turns = 0;
      const ticking = setInterval(() => {
        turns += 1;
      }, 5);
      const part = await run
        .runPart(
          lists,
          query({
            source: "lists",
            mode: "groups",
            unwind: [{ path: "parts", preserve: false }],
            columns: [{ path: "parts" }, { fn: "count", path: "*" }],
            groupBy: { path: "parts" },
          }),
        )
        .finally(() => clearInterval(ticking));

      expect(part.groups.map(({ n }) => n).sort()).toEqual([
        20_000, 20_000, 20_000,
      ]);
      expect(part.groups.map(({ value }) => value)).toEqual([
        { k: [["code", "c0"]] },
        { k: [["code", "c1"]] },
        { k: [["code", "c2"]] },
      ]);
      expect(turns).toBeGreaterThan(1);
    });

    it("refuses to unwind a windowed read", async () => {
      expect(
        await refusal(
          run.runPart(
            source,
            query({
              where: test("grantCode", "contains", "rare"),
              unwind: [{ path: PARCELS, preserve: true }],
            }),
          ),
        ),
      ).toBe("GROUP_NEEDS_EXACT");
    });
  });
});
