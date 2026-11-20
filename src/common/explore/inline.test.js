import {
  Binary,
  Decimal128,
  Double,
  Int32,
  Long,
  ObjectId,
  Timestamp,
} from "mongodb";
import { describe, expect, it } from "vitest";
import { inlineOf, objectCellOf } from "./inline.js";

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

  it("prints Int32 and Double as plain numbers, as mongosh does", () => {
    expect(
      inlineOf({ a: new Int32(5), b: new Double(5), c: new Double(-0) }),
    ).toBe("{ a: 5, b: 5, c: -0 }");
  });

  it("writes a long text whole", () => {
    const long = `'${"x".repeat(1_000_000)}`;

    expect(inlineOf({ note: long })).toBe(
      `{ note: '\\'${"x".repeat(1_000_000)}' }`,
    );
  });

  it("writes a large object whole, visiting every value once", () => {
    let visited = 0;
    const big = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, n) => [`k${n}`, { v: n }]),
    );
    const text = inlineOf(big, {
      path: "big",
      charge: (units) => {
        visited += units;
      },
    });

    expect(text.endsWith("k9999: { v: 9999 } }")).toBe(true);
    expect(visited).toBe(20_001);
  });

  it("writes a 21-level object and a 3,552-item list whole", () => {
    let deep = { v: 1 };

    for (let n = 0; n < 21; n += 1) {
      deep = { d: deep };
    }

    expect(inlineOf(deep)).toBe(
      `${"{ d: ".repeat(21)}{ v: 1 }${" }".repeat(21)}`,
    );
    expect(inlineOf({ list: Array.from({ length: 3552 }, (_, n) => n) })).toBe(
      `{ list: [ ${Array.from({ length: 3552 }, (_, n) => n).join(", ")} ] }`,
    );
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

  it("writes a name object as the object it is", () => {
    expect(
      inlineOf({ applicant: { first: "Jo", middle: null, last: "Bloggs" } }),
    ).toBe("{ applicant: { first: 'Jo', middle: null, last: 'Bloggs' } }");
  });

  it("leaves out undefined values at any depth", () => {
    expect(inlineOf({ a: { sortCode: "1", _id: 2, b: 3, c: undefined } })).toBe(
      "{ a: { sortCode: '1', _id: 2, b: 3 } }",
    );
  });
});

describe("objectCellOf", () => {
  it("holds an object's text, every key, a name's parts too", () => {
    expect(objectCellOf({ first: "Sam", last: "Rowe" })).toEqual({
      text: "{ first: 'Sam', last: 'Rowe' }",
    });
  });
});
