import { Decimal128, Long } from "mongodb";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CHANGED_PATHS_MAX,
  payloadChanges,
  payloadHash,
} from "./payload-changes.js";

const pathsOf = (before, after) => payloadChanges(before, after).changedPaths;

describe("payloadChanges", () => {
  it("reports nothing for two equal payloads", () => {
    expect(
      payloadChanges(
        { id: "evt-1", data: { a: [1, { b: null }] } },
        { data: { a: [1, { b: null }] }, id: "evt-1" },
      ),
    ).toEqual({ changedPaths: [], changedPathsTruncated: false });
  });

  it("reports a changed value at its own path", () => {
    expect(
      pathsOf(
        { data: { sheetId: 1, other: "x" } },
        { data: { sheetId: "1", other: "x" } },
      ),
    ).toEqual(["/data/sheetId"]);
  });

  it("reports added and removed keys", () => {
    expect(pathsOf({ a: 1, b: 2 }, { a: 1, c: 3 })).toEqual(["/b", "/c"]);
  });

  it("reports array indices, including added and removed elements", () => {
    expect(pathsOf({ list: [1, 2, 3] }, { list: [1, 5] })).toEqual([
      "/list/1",
      "/list/2",
    ]);
  });

  it("reports a type change without walking into it", () => {
    expect(pathsOf({ data: { a: 1, b: 2 } }, { data: [1, 2] })).toEqual([
      "/data",
    ]);
    expect(pathsOf({ data: null }, { data: {} })).toEqual(["/data"]);
  });

  it("reports a whole replaced payload as the empty pointer", () => {
    expect(pathsOf({ a: 1 }, [1])).toEqual([""]);
  });

  it("escapes ~ and / in keys, and leaves dots alone", () => {
    expect(
      pathsOf(
        { "a/b": 1, "c~d": 1, "e.f": 1, "~1": 1 },
        { "a/b": 2, "c~d": 2, "e.f": 2, "~1": 2 },
      ),
    ).toEqual(["/a~1b", "/c~0d", "/e.f", "/~01"]);
  });

  it("treats __proto__, toString and constructor as ordinary keys", () => {
    const before = JSON.parse(
      '{"__proto__": {"x": 1}, "toString": "a", "constructor": "b"}',
    );
    const after = JSON.parse(
      '{"__proto__": {"x": 2}, "toString": "c", "constructor": "d"}',
    );

    expect(pathsOf(before, after)).toEqual([
      "/__proto__/x",
      "/toString",
      "/constructor",
    ]);
  });

  it("does not see a key the object only inherits", () => {
    expect(pathsOf({}, JSON.parse('{"toString": "a"}'))).toEqual(["/toString"]);
    expect(pathsOf({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("reports a stored BSON value replaced by its JSON text", () => {
    const at = new Date("2026-09-23T10:00:00.000Z");

    expect(pathsOf({ time: at }, { time: at.toISOString() })).toEqual([
      "/time",
    ]);
  });

  it("reports a stored BSON number replaced by its JSON text, as a Date is", () => {
    expect(
      pathsOf(
        {
          big: Long.fromString("9007199254740993"),
          amount: Decimal128.fromString("1.10"),
        },
        { big: "9007199254740993", amount: "1.10" },
      ),
    ).toEqual(["/big", "/amount"]);
  });

  it("never carries a value", () => {
    const { changedPaths } = payloadChanges(
      { data: { email: "old@example.com" } },
      { data: { email: "new@example.com" } },
    );

    expect(JSON.stringify(changedPaths)).not.toContain("example.com");
  });

  it(`caps the list at ${CHANGED_PATHS_MAX} and says so`, () => {
    const before = Object.fromEntries(
      Array.from({ length: 80 }, (_, n) => [`k${n}`, n]),
    );
    const after = Object.fromEntries(
      Array.from({ length: 80 }, (_, n) => [`k${n}`, n + 1]),
    );

    const changes = payloadChanges(before, after);

    expect(changes.changedPaths).toHaveLength(CHANGED_PATHS_MAX);
    expect(changes.changedPaths[0]).toBe("/k0");
    expect(changes.changedPathsTruncated).toBe(true);
  });

  it("is not truncated at exactly the cap", () => {
    const before = Object.fromEntries(
      Array.from({ length: CHANGED_PATHS_MAX }, (_, n) => [`k${n}`, n]),
    );

    const changes = payloadChanges(before, {});

    expect(changes.changedPaths).toHaveLength(CHANGED_PATHS_MAX);
    expect(changes.changedPathsTruncated).toBe(false);
  });

  it("stops walking once past the cap", () => {
    const nested = { a: Array.from({ length: 1000 }, (_, n) => n) };

    const changes = payloadChanges(nested, { a: [] });

    expect(changes.changedPaths).toHaveLength(CHANGED_PATHS_MAX);
    expect(changes.changedPathsTruncated).toBe(true);
  });
});

describe("payloadHash", () => {
  it("is the sha256 of the JSON text", () => {
    const payload = { id: "evt-1", data: { a: 1 } };

    expect(payloadHash(payload)).toBe(
      createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    );
  });

  it("differs when the payload does", () => {
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });

  it("hashes a BSON number as the JSON text the editor is given", () => {
    expect(
      payloadHash({
        big: Long.fromString("9007199254740993"),
        amount: Decimal128.fromString("1.10"),
      }),
    ).toBe(payloadHash({ big: "9007199254740993", amount: "1.10" }));
  });
});
