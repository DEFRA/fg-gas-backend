import { describe, expect, it } from "vitest";
import { lex } from "./lex.js";

const kinds = (text) => lex(text).map(({ k }) => k);
const first = (text) => lex(text)[0];

describe("lex", () => {
  it("cuts a query into words, punctuation and values, with spans", () => {
    expect(lex("db.cases.find({ n: -4.5 });")).toEqual([
      { k: "word", v: "db", at: 0, end: 2, text: "db" },
      { k: ".", at: 2, end: 3, text: "." },
      { k: "word", v: "cases", at: 3, end: 8, text: "cases" },
      { k: ".", at: 8, end: 9, text: "." },
      { k: "word", v: "find", at: 9, end: 13, text: "find" },
      { k: "(", at: 13, end: 14, text: "(" },
      { k: "{", at: 14, end: 15, text: "{" },
      { k: "word", v: "n", at: 16, end: 17, text: "n" },
      { k: ":", at: 17, end: 18, text: ":" },
      { k: "num", v: -4.5, at: 19, end: 23, text: "-4.5" },
      { k: "}", at: 24, end: 25, text: "}" },
      { k: ")", at: 25, end: 26, text: ")" },
      { k: ";", at: 26, end: 27, text: ";" },
    ]);
  });

  it.each([
    ["'hill'", "hill", true],
    ['"hill"', "hill", true],
    ["'it\\'s'", "it's", true],
    ["'a\\\\b'", "a\\b", true],
    ["'a\\nb'", "anb", true],
    ["'open", "open", false],
    ["'line\nnext'", "line", false],
    ["'end\\", "end\\", false],
  ])("reads the text %j as %j", (text, value, closed) => {
    expect(first(text)).toMatchObject({ k: "str", v: value, closed });
  });

  it("ends unclosed text at the line break", () => {
    expect(first("'line\nnext'")).toMatchObject({ at: 0, end: 5 });
  });

  it.each([
    ["{ a: /hill/i }", 5],
    ["[/a/, /b/]", 1],
    ["find(/x/)", 5],
    ["/x/", 0],
  ])("reads a pattern where a value starts: %j", (text, at) => {
    expect(lex(text).find(({ k }) => k === "re")).toMatchObject({ at });
  });

  it("reads a pattern's source as written, escapes kept, and its flags", () => {
    expect(first("/a\\/b\\d/gimsu")).toMatchObject({
      k: "re",
      v: "a\\/b\\d",
      flags: "gimsu",
      closed: true,
      end: 13,
    });
    expect(first("/open")).toMatchObject({ k: "re", closed: false });
  });

  it("reads a pattern after a comment, which doesn't count", () => {
    expect(kinds("find( // a note\n/x/)")).toEqual([
      "word",
      "(",
      "comment",
      "re",
      ")",
    ]);
  });

  it("reads / elsewhere as a bad token", () => {
    expect(kinds("a / b")).toEqual(["word", "bad", "word"]);
  });

  it("reads // as a comment to the end of the line", () => {
    expect(lex("a // note\nb")).toMatchObject([
      { k: "word" },
      { k: "comment", at: 2, end: 9 },
      { k: "word", v: "b" },
    ]);
  });

  it("reads $words, and a number glued to a word as part of nothing", () => {
    expect(lex("$gte $regex _id x1")).toMatchObject([
      { k: "word", v: "$gte" },
      { k: "word", v: "$regex" },
      { k: "word", v: "_id" },
      { k: "word", v: "x1" },
    ]);
    expect(kinds("1.5 -2 3.")).toEqual(["num", "num", "num", "."]);
  });

  it("reads anything else as a bad token of one character", () => {
    expect(lex("a # b")).toMatchObject([
      { k: "word" },
      { k: "bad", text: "#", at: 2, end: 3 },
      { k: "word" },
    ]);
    expect(kinds("+ = `")).toEqual(["bad", "bad", "bad"]);
  });
});
