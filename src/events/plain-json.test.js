import { Binary, Decimal128, Long, ObjectId, Timestamp } from "mongodb";
import { describe, expect, it } from "vitest";
import { isPlainJson, jsonKindOf, withJsonNumbers } from "./plain-json.js";

const NOT_PLAIN = [
  ["a Date", new Date("2026-09-23T10:00:00.000Z")],
  ["an ObjectId", new ObjectId()],
  ["a Long", Long.fromString("9007199254740993")],
  ["a Decimal128", Decimal128.fromString("1.10")],
  ["a Binary", new Binary(Buffer.from("abc"))],
  ["2^53", 2 ** 53],
  ["-(2^53)", -(2 ** 53)],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["undefined", undefined],
];

describe("isPlainJson", () => {
  it("is true for plain nested objects and arrays", () => {
    expect(
      isPlainJson({
        id: "evt-1",
        time: "2026-09-23T10:00:00.000Z",
        data: {
          sbi: 106_284_736,
          area: 1.25,
          parcels: [{ sheetId: "SX0679", ok: true }, null],
          nested: { deeper: [[1, 2], []] },
        },
      }),
    ).toBe(true);
  });

  it("is true for the largest safe integers and a fraction", () => {
    expect(
      isPlainJson([Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0.1]),
    ).toBe(true);
  });

  it("is true for null at the top", () => {
    expect(isPlainJson(null)).toBe(true);
  });

  // A key by that name must not fool a constructor check.
  it("stays true for a plain object holding a constructor key", () => {
    expect(isPlainJson({ constructor: 1, toString: "x" })).toBe(true);
  });

  it("is true for an object with no prototype", () => {
    expect(isPlainJson(Object.assign(Object.create(null), { a: 1 }))).toBe(
      true,
    );
  });

  it.each(NOT_PLAIN)("is false for %s nested in an object", (_, value) => {
    expect(isPlainJson({ data: { value } })).toBe(false);
  });

  it.each(NOT_PLAIN)("is false for %s nested in an array", (_, value) => {
    expect(isPlainJson({ data: [1, [value]] })).toBe(false);
  });

  it("is false for a class instance", () => {
    expect(isPlainJson({ data: new Map() })).toBe(false);
  });
});

describe("jsonKindOf", () => {
  it.each([
    [null, "null"],
    ["s", "string"],
    [1, "number"],
    [true, "boolean"],
    [[], "array"],
    [{}, "object"],
    [new Date(), "other"],
    [new ObjectId(), "other"],
  ])("names %o as %s", (value, kind) => {
    expect(jsonKindOf(value)).toBe(kind);
  });
});

describe("withJsonNumbers", () => {
  it("gives a Long past 2^53 as its exact decimal text", () => {
    expect(withJsonNumbers(Long.fromString("9007199254740993"))).toBe(
      "9007199254740993",
    );
    expect(withJsonNumbers(Long.fromString("-9007199254740993"))).toBe(
      "-9007199254740993",
    );
  });

  it("gives a safe Long as a number", () => {
    expect(withJsonNumbers(Long.fromNumber(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("gives a Decimal128 as its exact decimal text", () => {
    expect(withJsonNumbers(Decimal128.fromString("1.10"))).toBe("1.10");
  });

  it("gives a Timestamp as a number, not a $ key", () => {
    expect(withJsonNumbers(new Timestamp({ t: 0, i: 7 }))).toBe(7);
  });

  it("converts them inside objects and arrays, leaving other values alone", () => {
    const at = new Date("2026-09-23T10:00:00.000Z");
    const ref = new ObjectId();

    expect(
      withJsonNumbers({
        data: {
          big: Long.fromString("9007199254740993"),
          amounts: [Decimal128.fromString("0.1"), 2],
          at,
          ref,
          name: "a",
        },
      }),
    ).toEqual({
      data: {
        big: "9007199254740993",
        amounts: ["0.1", 2],
        at,
        ref,
        name: "a",
      },
    });
  });

  it("keeps a key named __proto__ as an ordinary key", () => {
    const payload = JSON.parse('{"__proto__": {"a": 1}}');

    expect(Object.hasOwn(withJsonNumbers(payload), "__proto__")).toBe(true);
  });
});
