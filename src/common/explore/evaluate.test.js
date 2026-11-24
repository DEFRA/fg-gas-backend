import { Decimal128, Double, Int32, Long, ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  accumulate,
  bsonTypeName,
  cellOf,
  compareBson,
  compareOrdered,
  compileWhere,
  dateOf,
  expressionOf,
  groupKeyOf,
  isDateText,
  mergePartial,
  orderValueOf,
  orderedExpressionOf,
  orderedOf,
  orderedValue,
  partialValue,
  readAt,
  sentPartial,
  shapeValue,
  shownOrdered,
  shownPartial,
  unwindDoc,
  valueAt,
  valuesOf,
} from "./evaluate.js";

const at = (path) => ({ path, names: path.split(".") });

const service = { path: "service", read: (_, ctx) => [ctx.service] };

const readerOf = ({ path }) => (path === "service" ? service : at(path));

const doc = {
  _id: new ObjectId("65f000000000000000000001"),
  clientRef: "GLD-1",
  createdAt: "2026-10-13T14:48:00.000Z",
  submittedAt: new Date("2026-10-14T09:00:00.000Z"),
  status: "DEAD_LETTER",
  totalAmountPence: 123456,
  agreed: true,
  closedAt: null,
  tags: [],
  identifiers: { sbi: "200000001" },
  phases: [
    {
      code: "PRE_AWARD",
      answers: {
        applicant: { business: { name: "Hilltop  Farm" } },
        parcels: [
          {
            parcelId: "SX1234 9238",
            actions: [
              { code: "CSAM1", value: 4.5 },
              { code: "CNUM2", value: 12 },
            ],
          },
          { parcelId: "SX1234 1111", actions: [{ code: "CSAM1", value: "7" }] },
        ],
        nested: [
          [1, 2],
          [3, [4]],
        ],
      },
    },
  ],
};

const matches = (where, on = doc, ctx = { service: "GAS" }) =>
  compileWhere(where, readerOf)(on, ctx);

const test = (path, op, ...values) => ({ path, op, values });

const date = (text) => ({ date: text });

describe("readAt", () => {
  it("walks every list at every step, as Mongo does", () => {
    expect(valuesOf(doc, at("phases.answers.parcels.parcelId"))).toEqual([
      "SX1234 9238",
      "SX1234 1111",
    ]);
    expect(valuesOf(doc, at("phases.answers.parcels.actions.code"))).toEqual([
      "CSAM1",
      "CNUM2",
      "CSAM1",
    ]);
  });

  it("reads a digits segment on a list as its position", () => {
    expect(valuesOf(doc, at("phases.0.code"))).toEqual(["PRE_AWARD"]);
    expect(valuesOf(doc, at("phases.0.answers.parcels.1.parcelId"))).toEqual([
      "SX1234 1111",
    ]);
    expect(valuesOf(doc, at("phases.3.code"))).toEqual([]);
  });

  it("gives a list's elements one level deep, never a list inside a list", () => {
    expect(valuesOf(doc, at("phases.answers.nested"))).toEqual([
      [1, 2],
      [3, [4]],
    ]);
  });

  it("says a path holding null or an empty list is there, a missing one isn't", () => {
    expect(readAt(doc, at("closedAt"))).toEqual({
      present: true,
      missing: false,
      values: [null],
    });
    expect(readAt(doc, at("tags"))).toEqual({
      present: true,
      missing: false,
      values: [],
    });
    expect(readAt(doc, at("missing.path"))).toEqual({
      present: false,
      missing: true,
      values: [],
    });
  });

  it("reads a key only of the record's own, never one it inherits", () => {
    expect(readAt(doc, at("clientRef.length")).present).toBe(false);
    expect(readAt(doc, at("identifiers.toString")).present).toBe(false);
  });

  it("reads what the source adds to a record from the box", () => {
    expect(valuesOf(doc, service, { service: "CW" })).toEqual(["CW"]);
  });
});

describe("compileWhere", () => {
  it("matches text exactly, case and spaces as stored", () => {
    expect(matches(test("clientRef", "eq", "GLD-1"))).toBe(true);
    expect(matches(test("clientRef", "eq", "gld-1"))).toBe(false);
    expect(
      matches(
        test("phases.answers.applicant.business.name", "eq", "Hilltop Farm"),
      ),
    ).toBe(false);
  });

  it("never equates values of different types", () => {
    expect(matches(test("totalAmountPence", "eq", 123456))).toBe(true);
    expect(matches(test("totalAmountPence", "eq", "123456"))).toBe(false);
    expect(matches(test("identifiers.sbi", "eq", 200000001))).toBe(false);
    expect(matches(test("agreed", "eq", true))).toBe(true);
    expect(matches(test("agreed", "eq", "true"))).toBe(false);
  });

  it("puts an object with its own _bsontype in no range, as a type it isn't", () => {
    const odd = { x: { _bsontype: "custom", toString: null } };

    expect(
      ["lt", "lte", "gt", "gte"].map((op) => matches(test("x", op, 1), odd)),
    ).toEqual([false, false, false, false]);
  });

  it("matches any value of a list", () => {
    expect(
      matches(test("phases.answers.parcels.parcelId", "eq", "SX1234 1111")),
    ).toBe(true);
  });

  it("reads null as null or not there", () => {
    expect(matches(test("closedAt", "eq", null))).toBe(true);
    expect(matches(test("missing", "eq", null))).toBe(true);
    expect(matches(test("clientRef", "eq", null))).toBe(false);
    expect(matches(test("clientRef", "ne", null))).toBe(true);
  });

  it("reads $in with null as also not there", () => {
    expect(matches(test("missing", "in", null, "a"))).toBe(true);
    expect(matches(test("clientRef", "in", null, "GLD-1"))).toBe(true);
    expect(matches(test("clientRef", "in", "a", "b"))).toBe(false);
    expect(matches(test("clientRef", "nin", "a", "b"))).toBe(true);
    expect(matches(test("missing", "nin", "a"))).toBe(true);
  });

  it("holds $exists of any value there, null and [] too", () => {
    expect(matches(test("closedAt", "filled"))).toBe(true);
    expect(matches(test("tags", "filled"))).toBe(true);
    expect(matches(test("missing", "filled"))).toBe(false);
    expect(matches(test("missing", "empty"))).toBe(true);
    expect(matches(test("closedAt", "empty"))).toBe(false);
  });

  it("compares only values of the same type", () => {
    expect(matches(test("totalAmountPence", "gt", 100))).toBe(true);
    expect(matches(test("totalAmountPence", "gt", "100"))).toBe(false);
    expect(
      matches(test("phases.answers.parcels.actions.value", "gte", 12)),
    ).toBe(true);
    expect(
      matches(test("phases.answers.parcels.actions.value", "gt", 12)),
    ).toBe(false);
    expect(matches(test("clientRef", "gt", "GLA"))).toBe(true);
    expect(matches(test("clientRef", "lt", "GLA"))).toBe(false);
    expect(matches(test("agreed", "gt", false))).toBe(true);
  });

  it("compares a date with a stored Date and with stored ISO text, at the instant", () => {
    expect(
      matches(test("submittedAt", "gte", date("2026-10-14T09:00:00.000Z"))),
    ).toBe(true);
    expect(
      matches(test("submittedAt", "gt", date("2026-10-14T09:00:00.000Z"))),
    ).toBe(false);
    expect(matches(test("createdAt", "gte", date("2026-10-13")))).toBe(true);
    expect(matches(test("createdAt", "lt", date("2026-10-13")))).toBe(false);
    expect(
      matches(test("createdAt", "eq", date("2026-10-13T14:48:00.000Z"))),
    ).toBe(true);
    expect(matches(test("createdAt", "eq", date("2026-10-13")))).toBe(false);
  });

  it("compares text with text only, never a stored Date", () => {
    expect(matches(test("createdAt", "gte", "2026-10-13"))).toBe(true);
    expect(matches(test("submittedAt", "gte", "2026-01-01"))).toBe(false);
    expect(matches(test("createdAt", "eq", "2026-10-13T14:48:00.000Z"))).toBe(
      true,
    );
  });

  it("matches a pattern against text only, as stored", () => {
    const pattern = (source, flags = "") =>
      test("phases.answers.applicant.business.name", "regex", {
        pattern: source,
        flags,
      });

    expect(matches(pattern("hilltop", "i"))).toBe(true);
    expect(matches(pattern("hilltop"))).toBe(false);
    expect(matches(pattern("p  F"))).toBe(true);
    expect(
      matches(test("totalAmountPence", "regex", { pattern: "123", flags: "" })),
    ).toBe(false);
  });

  it("negates $ne, $nin and $exists: false over every value", () => {
    expect(
      matches(test("phases.answers.parcels.actions.code", "ne", "CSAM1")),
    ).toBe(false);
    expect(
      matches(test("phases.answers.parcels.actions.code", "ne", "OTHER")),
    ).toBe(true);
  });

  it("combines all, any and not", () => {
    const yes = test("clientRef", "eq", "GLD-1");
    const no = test("clientRef", "eq", "x");

    expect(matches({ all: [yes, no] })).toBe(false);
    expect(matches({ any: [no, yes] })).toBe(true);
    expect(matches({ not: no })).toBe(true);
    expect(matches(null)).toBe(true);
  });

  it("tests what the source adds to a record", () => {
    expect(matches(test("service", "eq", "GAS"))).toBe(true);
    expect(matches(test("service", "eq", "GAS"), doc, { service: "CW" })).toBe(
      false,
    );
  });

  it("tests every element of a list too long to spread", () => {
    const long = { values: Array.from({ length: 250_000 }, (_, n) => n) };

    expect(matches(test("values", "eq", 249_999), long)).toBe(true);
    expect(matches(test("values", "gt", 250_000), long)).toBe(false);
  });

  it("charges each pattern's work", () => {
    const charged = [];

    compileWhere(
      test("clientRef", "regex", { pattern: "G.D", flags: "" }),
      readerOf,
      (units) => charged.push(units),
    )(doc, {});

    expect(charged.length).toBeGreaterThan(0);
  });
});

describe("isDateText and dateOf", () => {
  it("takes real ISO days and instants only", () => {
    expect(isDateText("2026-02-28")).toBe(true);
    expect(isDateText("2026-02-30")).toBe(false);
    expect(isDateText("2026-10-13T14:48:00.000Z")).toBe(true);
    expect(isDateText("2026-10-13T25:00Z")).toBe(false);
    expect(isDateText(20261013)).toBe(false);
  });

  it("takes the years 0 to 99 as written", () => {
    expect(isDateText("0001-01-01")).toBe(true);
    expect(isDateText("0096-02-29")).toBe(true);
    expect(isDateText("0099-02-29")).toBe(false);
  });

  it("reads a stored Date or ISO text as a date", () => {
    expect(dateOf("2026-10-13")).toEqual(new Date("2026-10-13"));
    expect(dateOf(doc.submittedAt)).toBe(doc.submittedAt);
    expect(dateOf("not a date")).toBeNull();
    expect(dateOf(new Date("nope"))).toBeNull();
  });
});

describe("shapeValue and cellOf", () => {
  it("shows each value as stored, a Date as an instant, an object inline", () => {
    expect(shapeValue("a")).toBe("a");
    expect(shapeValue(4.5)).toBe(4.5);
    expect(shapeValue(Number.NaN)).toBe("NaN");
    expect(shapeValue(true)).toBe("true");
    expect(shapeValue(null)).toBeNull();
    expect(shapeValue(new Date("2026-10-14T09:00:00Z"))).toBe(
      "2026-10-14T09:00:00.000Z",
    );
    expect(shapeValue(doc._id)).toBe("65f000000000000000000001");
    expect(shapeValue({ bank: { sortCode: "1" } })).toEqual({
      text: "{ bank: { sortCode: '1' } }",
    });
    expect(shapeValue({ a: 1, n: { first: "Sam", last: "Rowe" } })).toEqual({
      text: "{ a: 1, n: { first: 'Sam', last: 'Rowe' } }",
    });
    expect(shapeValue(Decimal128.fromString("1.50"))).toBe("1.50");
    expect(shapeValue([{ a: 1 }])).toEqual([{ text: "{ a: 1 }" }]);
    expect(shapeValue([undefined])).toEqual([null]);
  });

  it("shows numbers of every BSON type as numbers, where one holds them", () => {
    expect(shapeValue(new Int32(5))).toBe(5);
    expect(shapeValue(new Double(2.5))).toBe(2.5);
    expect(shapeValue(Long.fromNumber(7))).toBe(7);
    expect(shapeValue(Long.fromString("9007199254740993"))).toBe(
      "9007199254740993",
    );
    expect(shapeValue([new Int32(1), new Double(Number.NaN)])).toEqual([
      1,
      "NaN",
    ]);
  });

  it("shows a list inside a list as stored, whole at any depth", () => {
    expect(shapeValue([1, [2, [null, { a: 1 }]]])).toEqual([
      1,
      [2, [null, { text: "{ a: 1 }" }]],
    ]);
    expect(shapeValue([[[[[[[[[[[[1]]]]]]]]]]]])).toEqual([
      [[[[[[[[[[[1]]]]]]]]]]],
    ]);
  });

  it("shows every value of a long list", () => {
    const list = Array.from({ length: 3552 }, (_, n) => ({ parcel: n }));

    expect(shapeValue(list)).toHaveLength(3552);
    expect(shapeValue(list).at(-1)).toEqual({ text: "{ parcel: 3551 }" });
  });

  it("makes a cell of the path's value, a list through each list", () => {
    expect(cellOf(doc, at("clientRef"))).toBe("GLD-1");
    expect(cellOf(doc, at("phases.answers.parcels.parcelId"))).toEqual([
      ["SX1234 9238", "SX1234 1111"],
    ]);
    expect(cellOf(doc, at("missing"))).toBeNull();
    expect(cellOf(doc, at("closedAt"))).toBeNull();
    expect(cellOf(doc, at("tags"))).toEqual([]);
    expect(cellOf(doc, at("identifiers"))).toEqual({
      text: "{ sbi: '200000001' }",
    });
  });

  it("shows an object inline, every key of it", () => {
    expect(
      cellOf(
        {
          plan: {
            reference: "WMP-1",
            _hidden: "h",
            $ref: "b",
            amount: Decimal128.fromString("2.5"),
          },
        },
        at("plan"),
      ),
    ).toEqual({
      text: "{ reference: 'WMP-1', _hidden: 'h', '$ref': 'b', amount: Decimal128('2.5') }",
    });
  });

  it("shows a name object as the object it is", () => {
    expect(
      cellOf(
        { name: { title: "Dr", first: "Jo", last: "Bloggs" } },
        at("name"),
      ),
    ).toEqual({ text: "{ title: 'Dr', first: 'Jo', last: 'Bloggs' }" });
  });

  it("shows a list of one object as a list, as mongod's '$path' gives it", () => {
    expect(cellOf({ a: [{ id: "1" }] }, at("a"))).toEqual([
      { text: "{ id: '1' }" },
    ]);
    expect(cellOf({ a: [{ id: "1" }, { id: "2" }] }, at("a"))).toEqual([
      { text: "{ id: '1' }" },
      { text: "{ id: '2' }" },
    ]);
    expect(cellOf({ a: ["x"] }, at("a"))).toEqual(["x"]);
  });
});

describe("expressionOf", () => {
  const actions = at("phases.answers.parcels.actions.value");

  it("counts the outer list for $size", () => {
    expect(expressionOf("count", doc, at("phases"))).toBe(1);
    expect(expressionOf("count", doc, at("phases.answers.parcels"))).toBe(1);
    expect(expressionOf("count", doc, at("tags"))).toBe(0);
  });

  it.each([
    ["clientRef", "string"],
    ["missing", "missing"],
    ["closedAt", "null"],
    ["identifiers", "object"],
    ["_id", "objectId"],
  ])(
    "fails $size of %s, not a list, as mongod does, naming its type",
    (path, type) => {
      const failed = (() => {
        try {
          expressionOf("count", doc, at(path));
        } catch (error) {
          return error;
        }

        return null;
      })();

      expect(failed).toMatchObject({
        refusal: "MONGOD_ERROR",
        detail: { fn: "count", type },
      });
    },
  );

  it("names each number's BSON type as mongod does", () => {
    expect(
      [
        new Int32(1),
        Long.fromNumber(1),
        new Double(1),
        Decimal128.fromString("1"),
      ].map(bsonTypeName),
    ).toEqual(["int", "long", "double", "decimal"]);
    expect([true, new Date(0), [], undefined].map(bsonTypeName)).toEqual([
      "bool",
      "date",
      "array",
      "missing",
    ]);
  });

  it("sums a list's numbers one level deep, or the number, else 0", () => {
    expect(valueAt(doc, actions)).toEqual([[[4.5, 12], ["7"]]]);
    expect(expressionOf("sum", doc, actions)).toBe(0);
    expect(expressionOf("sum", { a: [1, "2", [3], 4] }, at("a"))).toBe(5);
    expect(expressionOf("sum", doc, at("totalAmountPence"))).toBe(123456);
    expect(expressionOf("sum", doc, at("clientRef"))).toBe(0);
  });

  it("takes a list's least or greatest element in Mongo's order", () => {
    expect(expressionOf("min", { a: [3, "x", null, 2] }, at("a"))).toBe(2);
    expect(expressionOf("max", { a: [3, "x", null, 2] }, at("a"))).toBe("x");
    expect(expressionOf("max", { a: [1, [2], { b: 1 }] }, at("a"))).toEqual([
      2,
    ]);
    expect(expressionOf("min", doc, at("missing"))).toBeNull();
  });
});

describe("accumulate", () => {
  const sent = (fn, values) =>
    sentPartial(
      fn,
      values.reduce((sofar, value) => accumulate(fn, sofar, value), undefined),
    );
  const over = (fn, values) => shownPartial(fn, sent(fn, values));

  it("sums numbers only, a list as nothing, 0 when there are none", () => {
    expect(over("sum", [1, [2, 3], "4", undefined, 5])).toBe(6);
    expect(over("sum", ["a", [1]])).toBe(0);
  });

  it("adds as mongod 8 does, its digits and all", () => {
    const values = [
      92.4013, -74.1224, 61.8119, 20.3899, 6.8913, -14.6344, 71.6488, 86.3213,
      83.5852,
    ];

    expect(over("sum", values)).toBe(334.29290000000003);
    expect(expressionOf("sum", { a: values }, at("a"))).toBe(
      334.29290000000003,
    );
    expect(values.reduce((a, b) => a + b, 0)).toBe(334.2929);
  });

  it("falls back to a plain sum when the compensated one overflows, as mongod does", () => {
    const values = [1e308, 1e308, 1];
    const half = (from) =>
      from.reduce((sofar, value) => accumulate("sum", sofar, value), undefined);

    expect(over("sum", values)).toBe("Infinity");
    expect(expressionOf("sum", { a: values }, at("a"))).toBe("Infinity");
    expect(JSON.parse(JSON.stringify(sent("sum", values)))).toEqual([
      { n: "NaN" },
      { n: "NaN" },
      { n: "Infinity" },
      "f",
      null,
    ]);
    expect(
      Number(
        partialValue(
          "sum",
          mergePartial(
            "sum",
            sentPartial("sum", half([1e308])),
            sentPartial("sum", half([1e308, 1])),
          ),
        ),
      ),
    ).toBe(Infinity);
    expect(
      Number(
        partialValue(
          "sum",
          mergePartial("sum", sentPartial("sum", half(values)), [1, 0, 1]),
        ),
      ),
    ).toBe(Infinity);
  });

  it("shows an overflowing part merged with a finite one as Infinity, in either order", () => {
    const overflowed = sent("sum", [1e308, 1e308]);
    const finite = sent("sum", [5]);

    expect(overflowed).toEqual([
      { n: "Infinity" },
      { n: "NaN" },
      { n: "Infinity" },
      "f",
      null,
    ]);
    expect(
      Number(partialValue("sum", mergePartial("sum", finite, overflowed))),
    ).toBe(Infinity);
    expect(
      Number(partialValue("sum", mergePartial("sum", overflowed, finite))),
    ).toBe(Infinity);
  });

  it("sends a merged sum's parts that aren't finite tagged, so JSON keeps them", () => {
    const merged = mergePartial(
      "sum",
      sent("sum", [1e308]),
      sent("sum", [1e308]),
    );
    const received = JSON.parse(JSON.stringify(merged));

    expect(received).toEqual([
      { n: "NaN" },
      { n: "NaN" },
      { n: "Infinity" },
      "f",
      null,
    ]);
    expect(Number(partialValue("sum", received))).toBe(Infinity);
    expect(mergePartial("sum", sent("sum", [1.5]), sent("sum", [2]))).toEqual([
      3.5,
      0,
      3.5,
      "f",
      null,
    ]);
  });

  it.each([
    [["NaN"], ["1"], "NaN"],
    [["Infinity"], ["-Infinity"], "NaN"],
    [["Infinity", "2"], ["3"], "Infinity"],
    [["1"], ["-Infinity"], "-Infinity"],
  ])(
    "merges Decimal128s %j and %j sent through JSON as mongod adds them, to %s",
    (first, second, total) => {
      const received = [first, second].map((texts) =>
        JSON.parse(
          JSON.stringify(sent("sum", texts.map(Decimal128.fromString))),
        ),
      );
      const merged = partialValue("sum", mergePartial("sum", ...received));

      expect([merged._bsontype, String(merged)]).toEqual(["Decimal128", total]);
    },
  );

  it("takes the least and greatest whole value, nulls and missing left out", () => {
    expect(over("min", [7, [], undefined, null, { a: 1 }])).toBe(7);
    expect(over("max", [7, [], { a: 1 }])).toEqual([]);
    expect(over("min", [undefined, null])).toBeNull();
  });

  it("orders a time as one type however it is stored", () => {
    const values = [
      "2026-10-15T00:00:00.000Z",
      new Date("2026-10-14T00:00:00Z"),
    ];

    expect(over("max", values)).toBe("2026-10-15T00:00:00.000Z");
    expect(over("min", values)).toBe("2026-10-14T00:00:00.000Z");
  });

  it("sends the least and greatest typed, so a boolean stays a boolean", () => {
    expect(sent("max", ["z", true])).toEqual({ b: true });
    expect(over("max", ["z", true])).toBe("true");
  });
});

describe("mergePartial", () => {
  it("adds counts and sums, and keeps the extreme of typed parts", () => {
    expect(mergePartial("count", 2, 3)).toBe(5);
    expect(
      shownPartial(
        "sum",
        mergePartial("sum", [0, 0, 0, "i", null], [3, 0, 3, "i", null]),
      ),
    ).toBe(3);
    expect(mergePartial("min", 4, "a")).toBe(4);
    expect(mergePartial("max", 4, "a")).toBe("a");
    expect(mergePartial("max", null, 4)).toBe(4);
    expect(mergePartial("max", [1], "a")).toEqual([1]);
    expect(
      mergePartial(
        "max",
        "2026-10-14T00:00:00.000Z",
        "2026-10-15T00:00:00.000Z",
      ),
    ).toBe("2026-10-15T00:00:00.000Z");
  });

  it("compares parts by their types, as Mongo does, not as they are shown", () => {
    expect(mergePartial("max", "z", { b: true })).toEqual({ b: true });
    expect(mergePartial("min", "z", { b: true })).toBe("z");
    expect(mergePartial("max", { k: [["a", 1]] }, { k: [["a", 2]] })).toEqual({
      k: [["a", 2]],
    });
    expect(
      mergePartial(
        "min",
        { d: "2026-10-15T00:00:00.000Z" },
        "2026-10-14T00:00:00.000Z",
      ),
    ).toBe("2026-10-14T00:00:00.000Z");
  });

  it("adds sums with what each part lost", () => {
    const values = [
      92.4013, -74.1224, 61.8119, 20.3899, 6.8913, -14.6344, 71.6488, 86.3213,
      83.5852,
    ];
    const partOf = (some) =>
      some.reduce((sofar, value) => accumulate("sum", sofar, value), undefined);

    expect(
      shownPartial(
        "sum",
        mergePartial(
          "sum",
          partOf(values.slice(0, 4)),
          partOf(values.slice(4)),
        ),
      ),
    ).toBeCloseTo(334.2929, 10);
  });
});

describe("BSON values and objects that travel typed", () => {
  it("groups, orders and shows a Decimal128 as the number it is", () => {
    const decimal = Decimal128.fromString("1.50");

    expect(groupKeyOf(decimal)).toBe(groupKeyOf(1.5));
    expect(compareBson(Decimal128.fromString("2"), 10)).toBe(-1);
    expect(shownOrdered(orderedOf({ amount: decimal }))).toEqual({
      text: "{ amount: Decimal128('1.50') }",
    });
  });

  it("sends an object whole, however wide or deep", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 150 }, (_, n) => [`k${n}`, n]),
    );
    const deep = Array.from({ length: 12 }).reduce(
      (inner) => ({ a: inner }),
      1,
    );

    expect(shownOrdered(orderedOf(wide)).text).toMatch(/k149: 149 }$/);
    expect(shownOrdered(orderedOf(deep)).text).toBe(
      `${"{ a: ".repeat(12)}1${" }".repeat(12)}`,
    );
  });

  it("sends each number with its BSON type, and reads it back so", () => {
    const values = [
      new Int32(5),
      new Double(5),
      new Double(-0),
      new Double(Number.NaN),
      Long.fromString("9007199254740993"),
      Decimal128.fromString("1.50"),
    ];
    const sent = JSON.parse(JSON.stringify(values.map(orderedOf)));

    expect(sent).toEqual([
      { i: 5 },
      { f: 5 },
      { f: "-0" },
      { f: "NaN" },
      { l: "9007199254740993" },
      { x: "1.50" },
    ]);
    expect(sent.map(orderedValue)).toEqual(values);
  });

  it("keeps an ObjectId its own type when grouping, ordering and showing", () => {
    const id = new ObjectId("65f000000000000000000001");

    expect(groupKeyOf(id)).not.toBe(groupKeyOf(String(id)));
    expect(compareBson(id, { a: 1 })).toBe(1);
    expect(shownOrdered(orderedOf({ id }))).toEqual({
      text: "{ id: ObjectId('65f000000000000000000001') }",
    });
  });

  it("keeps numbers past a double's precision apart, exactly, as numbers", () => {
    const [a, b] = ["9007199254740992", "9007199254740993"].map((text) =>
      Long.fromString(text),
    );
    const precise = Decimal128.fromString("0.12345678901234567891");

    expect(groupKeyOf(a)).toBe(groupKeyOf(9007199254740992));
    expect(groupKeyOf(b)).not.toBe(groupKeyOf(a));
    expect(groupKeyOf(b)).not.toBe(groupKeyOf("9007199254740993"));
    expect(groupKeyOf(b)).toBe(
      groupKeyOf(Decimal128.fromString("9007199254740993.0")),
    );
    expect(compareBson(b, a)).toBe(1);
    expect(compareBson(a, b)).toBe(-1);
    expect(compareBson(Long.fromString("-1152921504606846976"), 5)).toBe(-1);
    expect(compareBson(b, "a")).toBe(-1);
    expect(
      compareBson(
        Long.fromString("-9007199254740993"),
        Long.fromString("-9007199254740992"),
      ),
    ).toBe(-1);
    expect(compareBson(Decimal128.fromString("1E-400"), 0)).toBe(1);
    expect(orderedOf(Decimal128.fromString("Infinity"))).toEqual({
      x: "Infinity",
    });
    expect(orderedOf(Decimal128.fromString("NaN"))).toEqual({ x: "NaN" });
    expect(compareBson(Decimal128.fromString("-Infinity"), -1)).toBe(-1);

    expect(compareBson(0, Decimal128.fromString("-1E-400"))).toBe(1);
    expect(
      compareBson(
        Decimal128.fromString("-1E-400"),
        Decimal128.fromString("1E-400"),
      ),
    ).toBe(-1);
    expect(compareOrdered(orderedOf(b), orderedOf(a))).toBe(1);
    expect(shownOrdered(orderedOf(b))).toBe("9007199254740993");
    expect(
      shownOrdered(orderedOf(Long.fromString("9007199254740993000"))),
    ).toBe("9007199254740993000");
    expect(shownOrdered(orderedOf(precise))).toBe("0.12345678901234567891");
    expect(groupKeyOf(Decimal128.fromString("1.500E+1"))).toBe(groupKeyOf(15));
  });

  it("orders a decimal past a double's range inside the infinities", () => {
    const huge = Decimal128.fromString("1E+400");

    expect(compareBson(huge, Infinity)).toBe(-1);
    expect(compareBson(Infinity, huge)).toBe(1);
    expect(compareBson(Decimal128.fromString("Infinity"), huge)).toBe(1);
    expect(compareBson(Decimal128.fromString("-1E+400"), -Infinity)).toBe(1);
    expect(compareBson(huge, Decimal128.fromString("2E+400"))).toBe(-1);
    expect(compareBson(Infinity, Decimal128.fromString("Infinity"))).toBe(0);
  });

  it("orders NaN below every number and equal to NaN, either way round", () => {
    const nan = Decimal128.fromString("NaN");

    expect(compareBson(nan, 5)).toBe(-1);
    expect(compareBson(5, nan)).toBe(1);
    expect(compareBson(nan, -Infinity)).toBe(-1);
    expect(compareBson(nan, Number.NaN)).toBe(0);
    expect(compareBson(Number.NaN, nan)).toBe(0);
  });

  it("compares a long with a double by the double's exact value", () => {
    const above = Long.fromString("1152921504606846977");

    expect(compareBson(above, 2 ** 60)).toBe(1);
    expect(compareBson(2 ** 60, above)).toBe(-1);
    expect(compareBson(Long.fromString("1152921504606846976"), 2 ** 60)).toBe(
      0,
    );
    expect(
      compareBson(Decimal128.fromString("0.1000000000000000000001"), 0.1),
    ).toBe(-1);
  });

  it("orders ObjectIds after text, and groups each apart", () => {
    const id = new ObjectId("65f000000000000000000001");
    const other = new ObjectId("65f000000000000000000002");

    expect(compareBson(id, "z")).toBe(1);
    expect(groupKeyOf(id)).not.toBeNull();
    expect(groupKeyOf(id)).not.toBe(groupKeyOf(other));
    expect(groupKeyOf(id)).toBe(groupKeyOf(new ObjectId(String(id))));
    expect(groupKeyOf(id)).not.toBe(groupKeyOf("65f000000000000000000001"));
    expect(groupKeyOf({ id })).not.toBe(groupKeyOf({ id: other }));
  });

  it("orders a Decimal128 inside an object as a number", () => {
    expect(compareBson({ a: Decimal128.fromString("1") }, { a: 3 })).toBe(-1);
  });

  it("sends a long list inside an object whole", () => {
    const text = shownOrdered(
      orderedOf({ items: Array.from({ length: 150 }, () => 0) }),
    ).text;

    expect(text).toBe(`{ items: [ ${Array(150).fill(0).join(", ")} ] }`);
  });

  it("keeps a group's list of one object a list", () => {
    expect(shownOrdered(orderedOf([{ a: 1 }]))).toEqual([{ text: "{ a: 1 }" }]);
  });
});

describe("groupKeyOf", () => {
  it("keys a value with its type, so '1' and 1 are two groups", () => {
    expect(groupKeyOf("1")).not.toBe(groupKeyOf(1));
    expect(groupKeyOf(true)).not.toBe(groupKeyOf("true"));
  });

  it("keys a Date apart from ISO text, as mongod's $group does", () => {
    expect(groupKeyOf("2026-10-14T00:00:00.000Z")).not.toBe(
      groupKeyOf(new Date("2026-10-14T00:00:00.000Z")),
    );
  });

  it("keys numbers by value, whatever their BSON type", () => {
    expect(groupKeyOf(new Int32(5))).toBe(groupKeyOf(new Double(5)));
    expect(groupKeyOf(Long.fromNumber(5))).toBe(groupKeyOf(5));
    expect(groupKeyOf(Decimal128.fromString("5.0"))).toBe(groupKeyOf(5));
  });

  it("keys null and missing as one", () => {
    expect(groupKeyOf(null)).toBeNull();
    expect(groupKeyOf(undefined)).toBeNull();
  });

  it("keys objects and lists by what they hold, as a digest only", () => {
    expect(groupKeyOf({ a: 1 })).not.toBe(groupKeyOf({ b: 1 }));
    expect(groupKeyOf({ a: 1, b: 2 })).not.toBe(groupKeyOf({ b: 2, a: 1 }));
    expect(groupKeyOf([1, 2])).toBe(groupKeyOf([1, 2]));
    expect(groupKeyOf([1, 2])).not.toBe(groupKeyOf([2, 1]));
    expect(groupKeyOf(["1"])).not.toBe(groupKeyOf([1]));
    expect(groupKeyOf({ sortCode: "123456" })).toMatch(/^object:[0-9a-f]{64}$/);
  });
});

describe("unwindDoc", () => {
  const unwind = (record, path, preserve = false) => [
    ...unwindDoc(record, { names: path.split("."), preserve }),
  ];

  it("makes a row of each element, the path set to it, with its index", () => {
    expect(unwind({ _id: 1, a: { b: [1, [2]] } }, "a.b")).toEqual([
      [{ _id: 1, a: { b: 1 } }, 0],
      [{ _id: 1, a: { b: [2] } }, 1],
    ]);
  });

  it("makes no row of an empty list, null, a missing path or one through a list", () => {
    [{ a: [] }, { a: null }, {}, { a: [{ b: [1] }] }].forEach((record) =>
      expect(unwind(record, record.a?.[0] ? "a.b" : "a")).toEqual([]),
    );
  });

  it("keeps the record when asked, an empty list's key removed", () => {
    expect(unwind({ _id: 3, a: [] }, "a", true)).toEqual([[{ _id: 3 }, null]]);
    expect(unwind({ _id: 5, a: null }, "a", true)).toEqual([
      [{ _id: 5, a: null }, null],
    ]);
    expect(unwind({ _id: 4 }, "a", true)).toEqual([[{ _id: 4 }, null]]);
  });

  it("makes one row of a value that isn't a list", () => {
    expect(unwind({ a: 7 }, "a")).toEqual([[{ a: 7 }, null]]);
  });

  it("never changes the record", () => {
    const record = { a: { b: [1, 2] } };

    unwind(record, "a.b");

    expect(record).toEqual({ a: { b: [1, 2] } });
  });
});

describe("orderValueOf and compareBson", () => {
  it("sorts by a list's least value lowest first, its greatest highest first", () => {
    expect(orderValueOf(doc, at("clientRef"), false)).toBe("GLD-1");
    expect(orderValueOf({ a: [3, 1, "x"] }, at("a"), false)).toBe(1);
    expect(orderValueOf({ a: [3, 1, "x"] }, at("a"), true)).toBe("x");
    expect(orderValueOf(doc, at("missing"), false)).toBeNull();
  });

  it("sorts by a value with its type, so objects and booleans compare as Mongo's sort does", () => {
    const order = (value) => orderValueOf({ a: value }, at("a"), false);

    expect(compareOrdered(order({ n: 1 }), order({ n: 2 }))).toBe(-1);
    expect(compareOrdered(order(true), order("z"))).toBe(1);
    expect(compareOrdered(order(false), order(true))).toBe(-1);
    expect(
      compareOrdered(order(new Date("2026-10-15")), order("2026-10-14")),
    ).toBe(1);
    expect(
      compareOrdered(
        order(new ObjectId("65f000000000000000000002")),
        order(new ObjectId("65f000000000000000000001")),
      ),
    ).toBe(1);
    expect(shownOrdered(order({ n: 1 }))).toEqual({ text: "{ n: 1 }" });
    expect(shownOrdered(order(true))).toBe("true");
  });

  it("sends what a value sorts by whole, a number that isn't finite tagged", () => {
    const long = orderedOf(Array.from({ length: 150 }, (_, n) => n));

    expect(long).toHaveLength(150);
    expect(long.at(-1)).toBe(149);
    expect(orderedOf(Number.NaN)).toEqual({ n: "NaN" });
    expect(compareOrdered({ n: "-Infinity" }, -1)).toBe(-1);
  });

  it("shows a grouped or least or greatest list whole, as its cell does", () => {
    const parcels = Array.from({ length: 150 }, (_, n) => `P${n}`);
    const objects = Array.from({ length: 150 }, (_, n) => ({ id: n, a: 1 }));
    const greatest = sentPartial("max", accumulate("max", undefined, parcels));

    expect(shownOrdered(orderedOf(parcels))).toEqual(shapeValue(parcels));
    expect(shownPartial("max", greatest)).toEqual(parcels);
    expect(shownOrdered(orderedOf(objects))).toEqual(shapeValue(objects));
  });

  it("sorts by a worked-out value typed", () => {
    expect(orderedExpressionOf("max", { a: [true, "z"] }, at("a"))).toEqual({
      b: true,
    });
    expect(orderedExpressionOf("count", { a: [1, 2] }, at("a"))).toBe(2);
    expect(partialValue("count", 3)).toEqual(new Int32(3));
    expect(partialValue("max", undefined)).toBeNull();
  });

  it("sends every key of an object it sorts by", () => {
    expect(
      orderValueOf({ a: { name: "x", secret: "s" } }, at("a"), false),
    ).toEqual({
      k: [
        ["name", "x"],
        ["secret", "s"],
      ],
    });
  });

  it("orders values by type, then value", () => {
    expect(compareBson(1, "a")).toBe(-1);
    expect(compareBson("b", "a")).toBe(1);
    expect(compareBson(true, new Date())).toBe(-1);
    expect(
      compareBson("2026-10-15", new Date("2026-10-14T00:00:00.000Z")),
    ).toBe(1);
    expect(compareBson(null, 0)).toBe(-1);
  });

  it("orders objects key by key and lists element by element", () => {
    expect(compareBson({ a: 1 }, [])).toBe(-1);
    expect(compareBson([1, 2], [1, 3])).toBe(-1);
    expect(compareBson([1], [1, 0])).toBe(-1);
    expect(compareBson({ a: 2 }, { b: 1 })).toBe(-1);
    expect(compareBson({ a: 1 }, { a: 1 })).toBe(0);
  });
});

// Records and answers from mongod 7 (verify/scratch/arrays.js on the gpx
// stack), so the evaluator means what mongosh means.
describe("as mongod answers", () => {
  const records = [
    { _id: 1, a: [{ b: 1 }, { b: [2, 3] }, { c: 1 }, 5, [{ b: 4 }]] },
    { _id: 2, a: { b: [1, [2]] } },
    { _id: 3, a: [] },
    { _id: 4 },
    { _id: 5, a: null },
    { _id: 6, a: [{ b: { c: 1 } }, { b: [{ c: 2 }, { c: [3] }] }] },
    { _id: 7, a: 7 },
    { _id: 8, a: [1, "x", [2, 3], null, { b: 1 }] },
    { _id: 9, a: [{ 0: "zero" }, { b: 1 }] },
    { _id: 10, a: [{ b: null }, { c: 2 }] },
    { _id: 11, a: [[1, 2], [3]] },
    { _id: 12, a: { 0: { b: 9 } } },
  ];
  const ids = (where) =>
    records
      .filter((record) => compileWhere(where, readerOf)(record, {}))
      .map(({ _id }) => _id);

  it.each([
    [test("a.b", "eq", 1), [1, 2, 8, 9]],
    [test("a.b", "eq", 2), [1]],
    [test("a.b", "eq", 4), []],
    [test("a", "eq", 2), []],
    [test("a", "eq", 3), []],
    [test("a", "eq", 5), [1]],
    [test("a", "eq", 1), [8]],
    [test("a.b", "eq", null), [1, 4, 5, 7, 9, 10, 12]],
    [test("a.b", "filled"), [1, 2, 6, 8, 9, 10]],
    [test("a.b", "empty"), [3, 4, 5, 7, 11, 12]],
    [test("a.0", "eq", 1), [8]],
    [test("a.0.b", "eq", 1), [1]],
    [test("a.0.b", "eq", 9), [12]],
    [test("a.0", "eq", "zero"), [9]],
    [test("a.b.c", "eq", 3), [6]],
    [test("a.b.c", "eq", 1), [6]],
    [test("a", "gt", 1), [1, 7]],
    [test("a.b", "ne", 1), [3, 4, 5, 6, 7, 10, 11, 12]],
    [test("a.c", "gte", 1), [1, 10]],
    [test("a.b", "in", 3, null), [1, 4, 5, 7, 9, 10, 12]],
    [test("a", "eq", null), [4, 5, 8]],
    [test("a", "filled"), [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]],
    [test("a.4.b", "eq", 4), [1]],
    [test("a.5", "eq", null), [1, 2, 4, 5, 6, 7, 8, 9, 10, 12]],
    [test("a.0", "eq", null), [1, 2, 4, 5, 6, 7, 8, 9, 10]],
    [test("a.1.b", "eq", null), [1, 2, 4, 5, 6, 7, 8, 9, 10, 12]],
    [test("a.b.c", "eq", null), [1, 4, 5, 7, 8, 9, 10, 12]],
    [test("a.0", "filled"), [1, 6, 8, 9, 10, 11, 12]],
    [test("a.b", "nin", 1, null), [3, 6, 11]],
    [test("a", "lt", "z"), [8]],
    [test("a.b", "gte", 2), [1]],
  ])("filters %j as mongod does", (where, expected) => {
    expect(ids(where)).toEqual(expected);
  });

  it("gives '$a.b' and '$a.b.c' as mongod's $project does", () => {
    const project = (path) =>
      records
        .slice(0, 10)
        .map((record) => valueAt(record, at(path)) ?? "missing");

    expect(project("a.b")).toEqual([
      [1, [2, 3]],
      [1, [2]],
      [],
      "missing",
      "missing",
      [{ c: 1 }, [{ c: 2 }, { c: [3] }]],
      "missing",
      [1],
      [1],
      [null],
    ]);
    expect(project("a.b.c")).toEqual([
      [[]],
      [],
      [],
      "missing",
      "missing",
      [1, [2, [3]]],
      "missing",
      [],
      [],
      [],
    ]);
    expect(project("a.0")).toEqual([
      [],
      "missing",
      [],
      "missing",
      "missing",
      [],
      "missing",
      [],
      ["zero"],
      [],
    ]);
  });

  it("works out $size, $sum, $min and $max in $project as mongod does", () => {
    const sizes = [1, 3, 6, 8, 9, 10].map((n) =>
      ["a", "a.b"].map((path) =>
        expressionOf("count", records[n - 1], at(path)),
      ),
    );

    expect(sizes).toEqual([
      [5, 2],
      [0, 0],
      [2, 2],
      [5, 1],
      [2, 1],
      [2, 1],
    ]);
    expect(
      records.slice(0, 10).map((r) => expressionOf("sum", r, at("a"))),
    ).toEqual([5, 0, 0, 0, 0, 0, 7, 1, 0, 0]);
    expect(
      records.slice(0, 10).map((r) => expressionOf("sum", r, at("a.b"))),
    ).toEqual([1, 1, 0, 0, 0, 0, 0, 1, 1, 0]);
    expect(
      records.slice(0, 10).map((r) => expressionOf("min", r, at("a"))),
    ).toEqual([
      5,
      { text: "{ b: [ 1, [ 2 ] ] }" },
      null,
      null,
      null,
      { text: "{ b: { c: 1 } }" },
      7,
      1,
      { text: "{ b: 1 }" },
      { text: "{ b: null }" },
    ]);
    expect(expressionOf("max", records[0], at("a"))).toEqual([
      { text: "{ b: 4 }" },
    ]);
    expect(expressionOf("max", records[7], at("a"))).toEqual([2, 3]);
  });

  it("accumulates over records as mongod's $group does", () => {
    const over = (fn, path, from = records.slice(0, 10)) =>
      shownPartial(
        fn,
        sentPartial(
          fn,
          from.reduce(
            (sofar, record) => accumulate(fn, sofar, valueAt(record, at(path))),
            undefined,
          ),
        ),
      );

    expect(over("sum", "a")).toBe(7);
    expect(over("sum", "a.b")).toBe(0);
    expect(over("min", "a")).toBe(7);
    expect(over("min", "a.b")).toEqual([]);
    expect(over("max", "a.b")).toEqual([
      { text: "{ c: 1 }" },
      [{ text: "{ c: 2 }" }, { text: "{ c: [ 3 ] }" }],
    ]);
    expect(over("max", "a")).toEqual([
      { text: "{ b: { c: 1 } }" },
      { text: "{ b: [ { c: 2 }, { c: [ 3 ] } ] }" },
    ]);
    expect(over("sum", "a", records.slice(2, 5))).toBe(0);
    expect(over("min", "a", records.slice(2, 5))).toEqual([]);
  });

  it("groups by the whole value, null and missing as one", () => {
    const groups = new Map();

    records.slice(0, 10).forEach((record) => {
      const key = groupKeyOf(valueAt(record, at("a.b")));

      groups.set(key, (groups.get(key) ?? 0) + 1);
    });

    expect([...groups.values()].sort()).toEqual([1, 1, 1, 1, 1, 2, 3]);
    expect(groups.get(null)).toBe(3);
  });

  it("lists distinct values as mongod's distinct does", () => {
    const seen = new Map();

    records
      .slice(0, 10)
      .forEach((record) =>
        valuesOf(record, at("a.b")).forEach((value) =>
          seen.set(groupKeyOf(value) ?? "null", shapeValue(value)),
        ),
      );

    expect([...seen.values()]).toEqual(
      expect.arrayContaining([null, 1, 2, 3, { text: "{ c: 1 }" }, [2]]),
    );
    expect(seen.size).toBe(8);
  });

  it("unwinds as mongod's $unwind does", () => {
    const unwound = (path, preserve) =>
      records
        .slice(0, 10)
        .flatMap((record) =>
          [...unwindDoc(record, { names: path.split("."), preserve })].map(
            ([row]) => row,
          ),
        );

    expect(unwound("a", false).map(({ _id }) => _id)).toEqual([
      1, 1, 1, 1, 1, 2, 6, 6, 7, 8, 8, 8, 8, 8, 9, 9, 10, 10,
    ]);
    expect(unwound("a", true).map(({ _id }) => _id)).toEqual([
      1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 6, 7, 8, 8, 8, 8, 8, 9, 9, 10, 10,
    ]);
    expect(unwound("a.b", false)).toEqual([
      { _id: 2, a: { b: 1 } },
      { _id: 2, a: { b: [2] } },
    ]);
    expect(unwound("a.b", true)).toHaveLength(11);
    expect(unwound("a.0", false)).toEqual([]);
  });
});

describe("ObjectIds and keys starting $", () => {
  const hex = "65f000000000000000000001";
  const oid = (text) => ({ oid: text });
  const test = (path, op, ...values) => ({ path, op, values });

  it("matches an ObjectId by its type and value, never its hex as text", () => {
    expect(matches(test("_id", "eq", oid(hex)))).toBe(true);
    expect(matches(test("_id", "eq", hex))).toBe(false);
    expect(matches(test("_id", "eq", oid("65f000000000000000000002")))).toBe(
      false,
    );
    expect(matches(test("_id", "ne", oid(hex)))).toBe(false);
    expect(matches(test("_id", "in", hex, oid(hex)))).toBe(true);
    expect(matches(test("_id", "nin", hex, oid(hex)))).toBe(false);
    expect(matches(test("id", "eq", oid(hex)), { id: hex })).toBe(false);
  });

  it("compares ObjectIds by their bytes, and with nothing of another type", () => {
    expect(matches(test("_id", "gt", oid("65e0ffffffffffffffffffff")))).toBe(
      true,
    );
    expect(matches(test("_id", "lt", oid("65f000000000000000000010")))).toBe(
      true,
    );
    expect(matches(test("_id", "gte", oid(hex)))).toBe(true);
    expect(matches(test("_id", "lt", oid(hex)))).toBe(false);
    expect(matches(test("_id", "gt", "0"))).toBe(false);
    expect(matches(test("id", "lt", oid("f".repeat(24))), { id: "65f0" })).toBe(
      false,
    );
  });

  it("never matches an ObjectId with a pattern", () => {
    expect(
      matches({
        path: "_id",
        op: "regex",
        values: [{ pattern: "65f", flags: "" }],
      }),
    ).toBe(false);
  });

  it("walks a key starting $ as any other key, through lists", () => {
    const stored = {
      phases: [
        { questions: { $schema: "draft-07", $defs: { a: { $ref: "#/b" } } } },
        { questions: { $schema: "draft-04" } },
      ],
    };

    expect(
      matches(test("phases.questions.$schema", "eq", "draft-04"), stored),
    ).toBe(true);
    expect(valuesOf(stored, at("phases.questions.$defs.a.$ref"))).toEqual([
      "#/b",
    ]);
    expect(cellOf(stored, at("phases.questions.$schema"))).toEqual([
      "draft-07",
      "draft-04",
    ]);
  });

  it("keys a group of an ObjectId apart from its hex, and of an object by all of it", () => {
    expect(groupKeyOf(new ObjectId(hex))).toBe(`objectId:${hex}`);
    expect(groupKeyOf(hex)).toBe(`string:${hex}`);
    expect(groupKeyOf({ a: 1, _b: 2 })).not.toBe(groupKeyOf({ a: 1 }));
  });
});
