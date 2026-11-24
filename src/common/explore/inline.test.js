import { Binary, Decimal128, Long, ObjectId, Timestamp } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  MAX_INLINE_LENGTH,
  inlineOf,
  isNameObject,
  nameOf,
  objectCellOf,
} from "./inline.js";

describe("inlineOf", () => {
  it("prints a flat object as mongosh does", () => {
    expect(inlineOf({ reference: "WMP-2431", hectares: 18.5, ok: true })).toBe(
      "{ reference: 'WMP-2431', hectares: 18.5, ok: true }",
    );
  });

  it("prints nested objects and lists inline", () => {
    expect(
      inlineOf({
        reference: "WMP-2431",
        parcels: [{ sheet: "SU4471", id: "2210" }],
        none: null,
        empty: {},
        list: [],
      }),
    ).toBe(
      "{ reference: 'WMP-2431', parcels: [ { sheet: 'SU4471', id: '2210' } ], none: null, empty: {}, list: [] }",
    );
  });

  it("quotes a key that needs quotes", () => {
    expect(inlineOf({ "grant-code": "a", "2nd": 1, $ok: 2, a_1: 3 })).toBe(
      "{ 'grant-code': 'a', '2nd': 1, '$ok': 2, a_1: 3 }",
    );
  });

  it("escapes quotes, backslashes and control characters in text", () => {
    expect(inlineOf({ note: "it's a\\b\nc\td\u0001" })).toBe(
      "{ note: 'it\\'s a\\\\b\\nc\\td\\x01' }",
    );
  });

  it("quotes stored … text and keys as any other", () => {
    expect(inlineOf({ note: "…", "…": 1 })).toBe("{ note: '…', '…': 1 }");
  });

  it("prints other BSON values as one value", () => {
    expect(
      inlineOf({
        amount: Decimal128.fromString("1.50"),
        big: Long.fromNumber(5),
        when: new Timestamp({ t: 5, i: 2 }),
        data: new Binary(Buffer.from("hi")),
      }),
    ).toBe(
      "{ amount: Decimal128('1.50'), big: Long('5'), when: Timestamp({ t: 5, i: 2 }), data: Binary.createFromBase64('aGk=', 0) }",
    );
  });

  it("writes every key, whatever its name", () => {
    expect(
      inlineOf({
        _id: 1,
        $schema: "x",
        sortCode: "1",
        url: "u",
        hidden: { _x: 1 },
      }),
    ).toBe(
      "{ _id: 1, '$schema': 'x', sortCode: '1', url: 'u', hidden: { _x: 1 } }",
    );
  });

  it("escapes no more of a long text than it shows", () => {
    const text = inlineOf({ note: `'${"x".repeat(10_000_000)}` });

    expect(text).toHaveLength(MAX_INLINE_LENGTH);
    expect(text.startsWith("{ note: '\\'xxx")).toBe(true);
    expect(text.endsWith("x…")).toBe(true);
  });

  it("visits no more of a large object than its text shows", () => {
    let visited = 0;
    const big = Object.fromEntries(
      Array.from({ length: 100_000 }, (_, n) => [`k${n}`, { v: n }]),
    );
    const text = inlineOf(big, {
      path: "big",
      charge: (units) => {
        visited += units;
      },
    });

    expect(text).toHaveLength(MAX_INLINE_LENGTH);
    expect(visited).toBeLessThan(1000);
  });

  it("prints dates and ids as mongosh does", () => {
    expect(
      inlineOf({
        at: new Date("2026-10-14T09:00:00Z"),
        id: new ObjectId("65f000000000000000000001"),
        bad: new Date(Number.NaN),
      }),
    ).toBe(
      "{ at: ISODate('2026-10-14T09:00:00.000Z'), id: ObjectId('65f000000000000000000001'), bad: Invalid Date }",
    );
  });

  it("reads a name object inside as one name", () => {
    expect(
      inlineOf({ applicant: { first: "Jo", middle: null, last: "Bloggs" } }),
    ).toBe("{ applicant: 'Jo Bloggs' }");
  });

  it("leaves out undefined values at any depth", () => {
    expect(inlineOf({ a: { sortCode: "1", _id: 2, b: 3, c: undefined } })).toBe(
      "{ a: { sortCode: '1', _id: 2, b: 3 } }",
    );
  });

  it("cuts a long object short with …", () => {
    const text = inlineOf({ list: Array.from({ length: 1000 }, () => "abc") });

    expect(text).toHaveLength(MAX_INLINE_LENGTH);
    expect(text.endsWith("…")).toBe(true);
    expect(text.startsWith("{ list: [ 'abc', 'abc'")).toBe(true);
  });
});

describe("name objects", () => {
  it.each([
    [{ first: "Jo", last: "Bloggs" }, true],
    [{ title: "Dr", last: "Bloggs" }, true],
    [{ first: "Jo", age: 3 }, false],
    [{ title: "Dr" }, false],
    [{ first: 1 }, false],
    ["Jo", false],
  ])("%j is a name: %s", (value, is) => {
    expect(isNameObject(value)).toBe(is);
  });

  it("reads an object with any other field as an object", () => {
    expect(objectCellOf({ first: "Sam", last: "Rowe" })).toBe("Sam Rowe");
    expect(objectCellOf({ first: "Sam", last: "Rowe", secret: "s" })).toEqual({
      text: "{ first: 'Sam', last: 'Rowe', secret: 's' }",
    });
  });

  it("stops judging a name at the first field that is no part of one", () => {
    let read = 0;
    const value = { first: "Sam" };

    Array.from({ length: 1000 }, (_, n) =>
      Object.defineProperty(value, `k${n}`, {
        enumerable: true,
        get: () => {
          read += 1;

          return n;
        },
      }),
    );

    expect(isNameObject(value)).toBe(false);
    expect(read).toBeLessThan(5);
  });

  it("reads the parts there are, in order", () => {
    expect(nameOf({ last: "Bloggs", title: "Dr", first: "" })).toBe(
      "Dr Bloggs",
    );
  });
});
