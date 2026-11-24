import { describe, expect, it } from "vitest";
import { matchParts, residualPart } from "../buckets/engine.js";
import { testBucket } from "../buckets/test-bucket.js";
import { readersFor } from "./fields.js";
import { EXACT_READ, WINDOWED_READ, planBox } from "./plan.js";
import { testSource } from "./test-source.js";

const source = testSource();
const [outboxBox, inboxBox] = source.boxes;

const test = (path, op, ...values) => ({ path, op, values });

const date = (text) => ({ date: text });

const plan = (where, box = outboxBox) => {
  const query = { where, columns: [{ path: "ref" }], limit: 50 };
  const { readerOf } = readersFor(source);

  return planBox(source, box, query, readerOf);
};

describe("planBox", () => {
  it("reads everything exactly with no filter", () => {
    expect(plan(null)).toMatchObject({
      none: false,
      read: EXACT_READ,
      residual: null,
      recheck: null,
      query: { where: {}, ref: null },
    });
  });

  it("gives a closed fact its stored codes, as typed", () => {
    expect(plan(test("status", "eq", "DEAD_LETTER")).query.where).toEqual({
      status: "DEAD_LETTER",
    });
    expect(
      plan(test("status", "in", "COMPLETED", "FAILED")).query.where,
    ).toEqual({ status: ["COMPLETED", "FAILED"] });
  });

  it("finds nothing for a label, which no record stores", () => {
    expect(plan(test("status", "eq", "Dead letter")).query.where).toEqual({
      status: "Dead letter",
    });
  });

  it("reads $ne and $nin of a closed fact as $in of its other values and null", () => {
    const { query, read } = plan(test("eventType", "ne", "case.create"));

    expect(query.where).toEqual({ eventType: ["case.update.status", null] });
    expect(read).toBe(EXACT_READ);
  });

  it("drops a value a fact can't hold, and finds nothing with none left", () => {
    expect(plan(test("code", "in", "a", 7)).query.where).toEqual({
      code: "a",
    });
    expect(plan(test("code", "eq", 7)).none).toBe(true);
  });

  it("reads a ref path through the refs line, and rechecks the test itself", () => {
    const second = test("ref", "eq", "B");
    const read = plan({ all: [test("ref", "eq", " A "), second] });

    expect(read.query).toMatchObject({ ref: "ref:a", refKind: "ref" });
    expect(read.recheck).toEqual({ ref: " A " });
    expect(read.residual).toEqual(second);
    expect(read.read).toBe(WINDOWED_READ);
  });

  it("rechecks a list of refs with $in", () => {
    const read = plan(test("ref", "in", "A", "B"));

    expect(read.query.ref).toEqual(["ref:a", "ref:b"]);
    expect(read.recheck).toEqual({ ref: { $in: ["A", "B"] } });
    expect(read.read).toBe(EXACT_READ);
  });

  it("reads refs itself as stored, with nothing to recheck", () => {
    const read = plan(test("refs", "eq", "msg:M-1"));

    expect(read.query.ref).toBe("msg:M-1");
    expect(read.recheck).toBeNull();
    expect(read.read).toBe(EXACT_READ);
  });

  it("reads a stable ref typed as its ref through the index alone", () => {
    const read = plan(test("msg", "in", "m-1", "m-2"));

    expect(read.query.ref).toEqual(["msg:m-1", "msg:m-2"]);
    expect(read.recheck).toBeNull();
    expect(read.read).toBe(EXACT_READ);
  });

  it("rechecks a stable ref typed otherwise than its ref", () => {
    expect(plan(test("msg", "eq", "M-1")).recheck).toEqual({ msg: "M-1" });
    expect(plan(test("msg", "eq", " m-1")).recheck).toEqual({ msg: " m-1" });
  });

  it("reads an OR of refs and stable refs with nothing to recheck", () => {
    const read = plan({
      any: [test("msg", "eq", "m-1"), test("refs", "eq", "ref:a")],
    });

    expect(read.query.ref).toEqual(["msg:m-1", "ref:a"]);
    expect(read.recheck).toBeNull();
  });

  it("reads an OR of refs as one $in, rechecked as the OR of its tests", () => {
    const read = plan({
      any: [test("ref", "eq", "A"), test("refs", "eq", "msg:m-1")],
    });

    expect(read.query.ref).toEqual(["ref:a", "msg:m-1"]);
    expect(read.recheck).toEqual({
      $or: [{ ref: "A" }, { refs: "msg:m-1" }],
    });
    expect(read.read).toBe(EXACT_READ);
  });

  it("finds nothing for a ref value that isn't text", () => {
    expect(plan(test("ref", "eq", 7)).none).toBe(true);
  });

  it("tests a blank ref record by record", () => {
    expect(plan(test("ref", "eq", "")).read).toBe(WINDOWED_READ);
  });

  it("bounds the time at the instant of a date, whatever the operator", () => {
    expect(
      plan(test("publicationDate", "eq", date("2026-10-13"))).query,
    ).toMatchObject({
      from: "2026-10-13T00:00:00.000Z",
      to: "2026-10-13T00:00:00.000Z",
    });
    expect(
      plan({
        all: [
          test("publicationDate", "gt", date("2026-10-01")),
          test("publicationDate", "lte", date("2026-10-13T12:00:00Z")),
        ],
      }).query,
    ).toMatchObject({
      from: "2026-10-01T00:00:00.001Z",
      to: "2026-10-13T12:00:00.000Z",
    });
    expect(
      plan(test("publicationDate", "lt", date("2026-10-13"))).query,
    ).toMatchObject({ from: undefined, to: "2026-10-12T23:59:59.999Z" });
  });

  it("bounds a box that stores ISO text by a text bound, and finds nothing in one that stores Dates", () => {
    const text = test("publicationDate", "gte", "2026-10-01");

    expect(plan(text, inboxBox)).toMatchObject({
      none: false,
      read: EXACT_READ,
      query: { from: "2026-10-01T00:00:00.000Z" },
    });
    expect(plan(text, outboxBox).none).toBe(true);
  });

  it("bounds by a day typed as text as mongosh compares text: $gt takes the day, $lte doesn't", () => {
    const bound = (op, value) =>
      plan(test("publicationDate", op, value), inboxBox).query;

    expect(bound("gt", "2026-10-01").from).toBe("2026-10-01T00:00:00.000Z");
    expect(bound("gte", "2026-10-01").from).toBe("2026-10-01T00:00:00.000Z");
    expect(bound("lte", "2026-10-01").to).toBe("2026-09-30T23:59:59.999Z");
    expect(bound("lt", "2026-10-01").to).toBe("2026-09-30T23:59:59.999Z");
    expect(bound("lte", "2026-10-01T00:00:00.000Z").to).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(bound("gt", "2026-10-01T00:00:00.000Z").from).toBe(
      "2026-10-01T00:00:00.001Z",
    );
  });

  it.each(["2026-10-01T09:30Z", "2026-10-01T09:30:00+01:00", "2026-13-01"])(
    "tests a text bound %s that doesn't compare as its instant record by record",
    (value) => {
      expect(
        plan(test("publicationDate", "gte", value), inboxBox),
      ).toMatchObject({
        read: WINDOWED_READ,
        residual: test("publicationDate", "gte", value),
        query: { from: undefined },
      });
    },
  );

  it("settles a ref's facts as exact only with no residual left to test", () => {
    const ref = test("ref", "eq", "record-1");
    const status = test("status", "eq", "FAILED");

    expect(plan({ all: [ref, status] }).settles).toBe(true);
    expect(
      plan({ all: [ref, status, test("grantCode", "eq", "x")] }),
    ).toMatchObject({ settles: false, read: WINDOWED_READ });
  });

  it("reads nothing for a range that is empty", () => {
    expect(
      plan({
        all: [
          test("publicationDate", "gt", date("2026-10-02")),
          test("publicationDate", "lt", date("2026-10-01")),
        ],
      }).none,
    ).toBe(true);
  });

  it("keeps every index test under OR or NOT as a residual, so the read is windowed", () => {
    const or = {
      any: [test("status", "eq", "COMPLETED"), test("grantCode", "eq", "x")],
    };
    const not = { not: test("status", "eq", "COMPLETED") };

    expect(plan(or)).toMatchObject({
      residual: or,
      read: WINDOWED_READ,
      query: { where: {} },
    });
    expect(plan(not)).toMatchObject({ residual: not, read: WINDOWED_READ });
  });

  it("keeps a test of a path without an index, or an index path's other tests, as a residual", () => {
    expect(plan(test("grantCode", "eq", "x")).read).toBe(WINDOWED_READ);
    expect(
      plan(test("status", "regex", { pattern: "DEAD", flags: "" })).read,
    ).toBe(WINDOWED_READ);
    expect(plan(test("code", "ne", "x")).read).toBe(WINDOWED_READ);
    expect(plan(test("payload.answers.a", "eq", "x")).read).toBe(WINDOWED_READ);
  });

  it("is windowed for a version without its code, as the engine plans it", () => {
    expect(plan(test("version", "eq", "1.0.0")).read).toBe(WINDOWED_READ);
    expect(
      plan({ all: [test("code", "eq", "a"), test("version", "eq", "1.0.0")] })
        .read,
    ).toBe(EXACT_READ);
  });

  it("answers a test of the box itself from the box", () => {
    expect(plan(test("box", "eq", "inbox"), outboxBox).none).toBe(true);
    expect(plan(test("box", "eq", "inbox"), inboxBox)).toMatchObject({
      none: false,
      read: EXACT_READ,
    });
  });

  it("is exact on a fact the inbox doesn't index only through the engine's plan", () => {
    expect(plan(test("version", "eq", "1"), inboxBox).read).toBe(WINDOWED_READ);
  });

  it("tests a fact the lists read a missing value as, for what records hold", () => {
    const NO_ERROR = "No error recorded";
    const keyed = testBucket({
      facts: {
        ...testBucket().facts,
        errorKey: {
          label: "Error",
          param: "error",
          nullAs: { value: NO_ERROR, among: { status: ["DEAD_LETTER"] } },
        },
      },
      indexes: [["status", "errorKey"], ["code"]],
    });
    const keyedSource = {
      ...testSource([keyed]),
      paths: [
        ...testSource().paths,
        { path: "errorKey", type: "text", index: { fact: "errorKey" } },
      ],
    };
    const query = {
      where: {
        all: [
          test("status", "eq", "DEAD_LETTER"),
          test("errorKey", "eq", NO_ERROR),
        ],
      },
      columns: [{ path: "ref" }],
      limit: 50,
    };
    const planned = planBox(
      keyedSource,
      keyedSource.boxes[0],
      query,
      readersFor(keyedSource).readerOf,
    );
    const read = { ...planned, deadline: Date.now() + 1000 };

    expect(planned.bucket.facts.errorKey.nullAs).toBeNull();
    expect(JSON.stringify([...matchParts(read), residualPart(read)])).toContain(
      `"errorKey":"${NO_ERROR}"`,
    );
  });
});

describe("planBox by _id", () => {
  const oid = (n) => ({ oid: n.toString(16).padStart(24, "0") });

  it("reads ObjectIds as an id read, exact, every test the evaluator's", () => {
    const where = {
      all: [
        test("status", "eq", "FAILED"),
        test("ref", "eq", "R-1"),
        test("_id", "in", oid(1), oid(2)),
        test("publicationDate", "gte", date("2026-10-01")),
      ],
    };
    const planned = plan(where);

    expect(planned).toMatchObject({
      none: false,
      read: EXACT_READ,
      why: null,
      settles: false,
      ids: [oid(1).oid, oid(2).oid],
      residual: where,
      recheck: null,
      query: { where: {}, ref: null, from: "2026-10-01T00:00:00.000Z" },
      plan: { line: [], residual: [] },
    });
  });

  it("finds nothing in a box a box test leaves out", () => {
    const where = {
      all: [test("box", "eq", "inbox"), test("_id", "eq", oid(1))],
    };

    expect(plan(where, outboxBox).none).toBe(true);
    expect(plan(where, inboxBox).none).toBe(false);
  });

  it("reads past 50 ObjectIds, or an _id range, by the bucket", () => {
    const many = Array.from({ length: 51 }, (_, n) => oid(n));

    expect(plan(test("_id", "in", ...many))).toMatchObject({
      ids: null,
      read: WINDOWED_READ,
      why: { why: "TOO_MANY_IDS", path: "_id" },
    });
    expect(plan(test("_id", "gt", oid(1)))).toMatchObject({
      ids: null,
      read: WINDOWED_READ,
      why: { why: "NOT_INDEX_OPERATOR", path: "_id" },
    });
  });
});
