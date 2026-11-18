import { describe, expect, it } from "vitest";
import { MAX_LENGTH, MESSAGES, parse, sizeProblem } from "./parse.js";
import { lex } from "./lex.js";

const parsed = (text) => parse(text, lex(text));
const treeOf = (text) => parsed(text).tree;
const errorOf = (text) => parsed(text).error;
const firstArg = (text) => treeOf(text).calls[0].args[0];

describe("parse", () => {
  it("reads the call chain, every node with its span", () => {
    expect(treeOf("db.cases.find({ a: 1 }).sort({ b: -1 }).limit(5);")).toEqual(
      {
        source: { name: "cases", at: 3, end: 8 },
        at: 0,
        end: 49,
        calls: [
          {
            name: "find",
            at: 9,
            end: 13,
            close: 23,
            args: [
              {
                type: "object",
                at: 14,
                end: 22,
                entries: [
                  {
                    key: "a",
                    at: 16,
                    end: 17,
                    value: { type: "number", value: 1, at: 19, end: 20 },
                  },
                ],
              },
            ],
          },
          expect.objectContaining({ name: "sort" }),
          expect.objectContaining({ name: "limit" }),
        ],
      },
    );
  });

  it("reads literal values: text, numbers, patterns, true, false, null, dates, lists", () => {
    const [entries] = [
      firstArg(
        "db.a.find({ t: 'x', n: 2, p: /h/i, y: true, f: false, z: null, d: ISODate('2026-10-01'), e: Date('2026-10-02'), l: [1, 'b'], 'q k': {} })",
      ).entries,
    ];

    expect(entries.map(({ key, value }) => [key, value.type])).toEqual([
      ["t", "text"],
      ["n", "number"],
      ["p", "pattern"],
      ["y", "literal"],
      ["f", "literal"],
      ["z", "literal"],
      ["d", "date"],
      ["e", "date"],
      ["l", "array"],
      ["q k", "object"],
    ]);
    expect(entries[2].value).toMatchObject({ pattern: "h", flags: "i" });
    expect(entries[5].value.value).toBeNull();
    expect(entries[6].value).toMatchObject({
      value: "2026-10-01",
      call: "ISODate",
    });
  });

  it("keeps objects as ordered entry lists, so no key is special", () => {
    expect(
      firstArg("db.a.find({ __proto__: 1, constructor: 2 })").entries.map(
        ({ key }) => key,
      ),
    ).toEqual(["__proto__", "constructor"]);
  });

  it("accepts trailing commas, as mongosh does", () => {
    expect(errorOf("db.a.find({ a: 1, }, { b: 1, },)")).toBeUndefined();
    expect(errorOf("db.a.find({ a: [1, 2,] })")).toBeUndefined();
  });

  it("ignores comments", () => {
    expect(errorOf("db.a // where\n.find() // all")).toBeUndefined();
  });

  it.each([
    ["db.a.find({ a: 1, a: 2 })", MESSAGES.twice("a"), "a: 2"],
    ["db.a.find({ a: 1 b: 2 })", MESSAGES.comma("b"), "b"],
    ["db.a.find({ a 1 })", MESSAGES.colon("a"), "1"],
    ["db.a.find({ 1: 1 })", MESSAGES.key, "1: 1"],
    ["db.a.find({ a: x })", MESSAGES.value, "x"],
    ["db.a.find({ a: ISODate(1) })", MESSAGES.date("ISODate"), "1"],
    ["db.a.find({ a: Date })", MESSAGES.open("Date"), "}"],
    ["db.a.find({}).sort({}).sort({})", MESSAGES.once("sort"), "sort({})"],
    ["db.a.find({}) x", MESSAGES.extra("x"), "x"],
    ["db.a.find({}).", "Then .sort({ … }) or .limit(…)", null],
    ["db.a.find({})..sort({})", "Then .sort({ … }) or .limit(…)", "."],
    [
      "db.a.(",
      "A method goes here: find, aggregate, countDocuments or distinct",
      "(",
    ],
    ["db.a.find({});;", MESSAGES.extra(";"), ";"],
  ])("refuses %j", (text, message, at) => {
    const error = errorOf(text);
    expect(error.message).toBe(message);
    expect(error.at).toBe(at === null ? text.length : text.lastIndexOf(at));
  });

  it.each([
    "db.a.find({ a: 9007199254740993 })",
    `db.a.find({ a: ${"9".repeat(400)} })`,
    "db.a.find({ a: -9007199254740992 })",
  ])("refuses a number past the safe range, where it is: %s", (text) => {
    const error = errorOf(text);

    expect(error.message).toBe(MESSAGES.number);
    expect(text.slice(error.at, error.end)).toMatch(/^-?\d+$/);
  });

  it("reads -0 as 0, as it travels", () => {
    expect(
      Object.is(firstArg("db.a.find({ a: -0 })").entries[0].value.value, 0),
    ).toBe(true);
  });

  it("reads the largest safe numbers", () => {
    expect(
      errorOf("db.a.find({ a: 9007199254740991, b: -9007199254740991 })"),
    ).toBeUndefined();
  });

  it("counts depth by the objects and lists that open, a value inside the 8th included", () => {
    expect(
      errorOf(`db.a.find(${"[".repeat(8)}1${"]".repeat(8)})`),
    ).toBeUndefined();
  });

  it("refuses depth past 8 while reading", () => {
    const deep = (n) => `db.a.find(${"[".repeat(n)}${"]".repeat(n)})`;

    expect(errorOf(deep(8))).toBeUndefined();
    expect(errorOf(deep(9)).message).toBe(MESSAGES.nesting);
  });

  it("refuses text past 4,000 characters, and past 1,000 tokens", () => {
    const long = `db.a.find({ a: '${"x".repeat(MAX_LENGTH)}' })`;
    const many = `db.a.find({ a: [${"1,".repeat(600)}] })`;

    expect(sizeProblem(long, lex(long))).toEqual({
      message: MESSAGES.length,
      at: MAX_LENGTH,
      end: long.length,
    });
    expect(sizeProblem(many, lex(many)).message).toBe(MESSAGES.tokens);
    expect(sizeProblem("db.a.find()", lex("db.a.find()"))).toBeNull();
  });
});
